import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { materializeWorkspace } from "./workspace.mjs";

export class TeamService {
  constructor({ store, rpc, workspaceRoot, dataRoot = path.dirname(workspaceRoot), projectAdapter = null }) {
    this.store = store;
    this.rpc = rpc;
    this.workspaceRoot = workspaceRoot;
    this.dataRoot = dataRoot;
    this.projectAdapter = projectAdapter;
    this.memberQueues = new Map();
  }

  async createTeam(input) {
    const id = randomUUID();
    const cwd = path.join(this.workspaceRoot, id);
    await mkdir(cwd, { recursive: true });
    const team = await this.store.createTeam({
      id,
      projectId: id,
      name: input.name,
      cwd
    });
    await this.#syncNativeProjects();
    return team;
  }

  async updateTeam(teamId, input) {
    const updated = await this.store.updateTeam(teamId, input);
    await this.#syncNativeProjects();
    await Promise.all(updated.members.map((member) => this.rpc.request("thread/resume", {
      ...resumeParams(updated, member)
    }).catch(() => undefined)));
    return updated;
  }

  async deleteTeam(teamId) {
    const team = await this.store.findTeam(teamId);
    await this.projectAdapter?.removeTeam(team);
    const removed = await this.store.removeTeam(teamId);
    return {
      removed,
      preserved: {
        threadIds: removed.members.map((member) => member.threadId),
        cwds: [removed.cwd, ...removed.members.map((member) => member.cwd)]
      }
    };
  }

  async snapshot() {
    const state = await this.store.read();
    await this.projectAdapter?.sync(state.teams);
    const threadSnapshot = await this.#listThreadSummaries()
      .then((summaries) => ({ summaries, connectionStatus: "connected" }))
      .catch(() => ({ summaries: new Map(), connectionStatus: "disconnected" }));
    return {
      version: state.version,
      revision: state.revision,
      connectionStatus: threadSnapshot.connectionStatus,
      teams: await Promise.all(state.teams.map(async (team) => ({
        ...team,
        members: await Promise.all(team.members.map(async (member) => {
          const summary = threadSnapshot.summaries.get(member.threadId);
          return {
            ...member,
            avatar: await avatarForUi(member.avatar),
            status: runtimeStatus(summary),
            lastActivityAt: summary?.recencyAt ?? summary?.updatedAt ?? null
          };
        }))
      })))
    };
  }

  async createMember(input) {
    const state = await this.store.read();
    const team = state.teams.find((candidate) => candidate.id === input.teamId);
    if (!team) throw new Error(`Team not found: ${input.teamId}`);
    const memberId = randomUUID();
    const cwd = await materializeWorkspace({
      root: team.cwd,
      memberName: input.name,
      source: input.projectSource ?? null
    });
    const threadId = await this.#startMemberThread(team, {
      id: memberId,
      name: input.name,
      role: input.role,
      cwd,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null
    });
    const avatar = input.avatarDataUrl
      ? await saveAvatar(this.dataRoot, memberId, input.avatarDataUrl)
      : input.avatar ?? null;
    const member = await this.store.addMember(team.id, {
      id: memberId,
      name: input.name,
      avatar,
      role: input.role,
      cwd,
      threadId,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null
    });
    await this.#syncNativeProjects();
    return member;
  }

  async updateMember(input) {
    const found = await this.store.findMember(input.teamId, input.memberId);
    const avatar = input.avatarDataUrl
      ? await saveAvatar(this.dataRoot, input.memberId, input.avatarDataUrl)
      : input.avatar;
    const updated = await this.store.updateMember(input.teamId, input.memberId, {
      name: input.name,
      role: input.role,
      ...(avatar !== undefined ? { avatar } : {}),
      model: input.model,
      reasoningEffort: input.reasoningEffort
    });
    await this.rpc.request("thread/name/set", { threadId: updated.threadId, name: updated.name }).catch(() => undefined);
    await this.rpc.request("thread/resume", {
      threadId: updated.threadId,
      cwd: updated.cwd,
      developerInstructions: memberInstructions({
        team: found.team,
        memberId: updated.id,
        memberName: updated.name,
        role: updated.role
      }),
      ...(updated.model ? { model: updated.model } : {}),
      ...(updated.reasoningEffort
        ? { config: { model_reasoning_effort: updated.reasoningEffort } }
        : {})
    }).catch(() => undefined);
    return updated;
  }

  async deleteMember(teamId, memberId) {
    const { member } = await this.store.findMember(teamId, memberId);
    await this.projectAdapter?.removeMember(member.threadId);
    const removed = await this.store.removeMember(teamId, memberId);
    return {
      removed,
      preserved: { threadId: removed.threadId, cwd: removed.cwd }
    };
  }

  async openMember(teamId, memberId) {
    const { team, member } = await this.store.findMember(teamId, memberId);
    try {
      await this.rpc.request("thread/resume", resumeParams(team, member));
      await this.projectAdapter?.openThread(member.threadId);
      return member;
    } catch (error) {
      if (!isMissingThreadError(error)) throw error;
      const threadId = await this.#startMemberThread(team, member);
      const replacement = await this.store.replaceMemberThread(teamId, memberId, threadId);
      await this.#syncNativeProjects();
      await this.projectAdapter?.openThread(replacement.threadId);
      return replacement;
    }
  }

  async navigateMember(teamId, memberId) {
    const { member } = await this.store.findMember(teamId, memberId);
    await this.projectAdapter?.openThread(member.threadId);
    return member;
  }

  sendMessage(input) {
    const key = `${input.teamId}:${input.targetMemberId}`;
    const previous = this.memberQueues.get(key) ?? Promise.resolve();
    const current = previous.then(() => this.#sendMessage(input));
    this.memberQueues.set(key, current.catch(() => undefined));
    return current;
  }

  async #sendMessage(input) {
    const { member } = await this.store.findMember(input.teamId, input.targetMemberId);
    const text = `来自「${requiredText(input.sourceName, "Source member")}」的团队消息：\n\n${requiredText(input.message, "Message")}`;
    const resumed = await this.rpc.request("thread/resume", {
      threadId: member.threadId,
      cwd: member.cwd
    });
    const activeTurn = [...(resumed?.thread?.turns ?? [])]
      .reverse()
      .find((turn) => turn?.status === "inProgress");
    let turnId;
    if (resumed?.thread?.status?.type === "active" && activeTurn) {
      const response = await this.rpc.request("turn/steer", {
        threadId: member.threadId,
        expectedTurnId: requiredId(activeTurn.id, "active turn"),
        input: [{ type: "text", text }]
      });
      turnId = requiredId(response?.turnId, "turn/steer");
    } else {
      const response = await this.rpc.request("turn/start", {
        threadId: member.threadId,
        cwd: member.cwd,
        input: [{ type: "text", text }],
        ...(member.model ? { model: member.model } : {}),
        ...(member.reasoningEffort ? { effort: member.reasoningEffort } : {})
      });
      turnId = requiredId(response?.turn?.id, "turn/start");
    }
    return { accepted: true, threadId: member.threadId, turnId };
  }

  async #listThreadSummaries() {
    const result = new Map();
    let cursor = null;
    do {
      const page = await this.rpc.request("thread/list", { cursor, limit: 100 });
      for (const thread of page?.data ?? []) {
        if (typeof thread?.id === "string") result.set(thread.id, thread);
      }
      cursor = typeof page?.nextCursor === "string" && page.nextCursor ? page.nextCursor : null;
    } while (cursor);
    return result;
  }

  async #syncNativeProjects() {
    if (!this.projectAdapter) return;
    const state = await this.store.read();
    await this.projectAdapter.sync(state.teams);
  }

  async #startMemberThread(team, member) {
    const started = await this.rpc.request("thread/start", {
      cwd: member.cwd,
      ...(member.model ? { model: member.model } : {}),
      ...(member.reasoningEffort
        ? { config: { model_reasoning_effort: member.reasoningEffort } }
        : {}),
      developerInstructions: memberInstructions({
        team,
        memberId: member.id,
        memberName: member.name,
        role: member.role
      }),
      serviceName: "codex-agent-team"
    });
    const threadId = requiredId(started?.thread?.id, "thread/start");
    await this.rpc.request("thread/name/set", { threadId, name: member.name }).catch(() => undefined);
    return threadId;
  }
}

function resumeParams(team, member) {
  return {
    threadId: member.threadId,
    cwd: member.cwd,
    developerInstructions: memberInstructions({
      team,
      memberId: member.id,
      memberName: member.name,
      role: member.role
    }),
    ...(member.model ? { model: member.model } : {}),
    ...(member.reasoningEffort
      ? { config: { model_reasoning_effort: member.reasoningEffort } }
      : {})
  };
}

function isMissingThreadError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:thread|conversation|rollout).*(?:not found|does not exist|missing|unknown)|(?:not found|does not exist|missing|unknown).*(?:thread|conversation|rollout)/i.test(message);
}

function runtimeStatus(summary) {
  if (!summary) return "offline";
  if (summary.status?.type !== "active") return "idle";
  const flags = summary.status.activeFlags ?? [];
  if (flags.some((flag) => /waiting|approval|input/i.test(String(flag)))) return "waiting";
  return "running";
}

export function memberInstructions({ team, memberId, memberName, role }) {
  return [
    `你是 Codex 团队「${team.name}」的成员「${memberName}」。`,
    `职责：${String(role ?? "").trim() || "按用户要求完成工作"}。`,
    `团队标识：${team.id}；成员标识：${memberId}。这些标识只用于显式团队通信。`,
    "你在独立的持久 Codex 会话和独立工作目录中工作。",
    "仅在明确需要其他成员协作时，显式调用 $codex-agent-team:communicate 发送团队消息。",
    "不要把普通 @ 文本解释为团队指令，不要自动转发收到的消息，也不要形成自动回复循环。",
    "如果团队模式未开启，停止团队通信并提示用户先打开团队模式。"
  ].join("\n");
}

async function saveAvatar(dataRoot, memberId, dataUrl) {
  const match = String(dataUrl).match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Avatar must be a PNG, JPEG, WebP, or GIF image");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 2 * 1024 * 1024) throw new Error("Avatar image must be smaller than 2 MB");
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const directory = path.join(dataRoot, "avatars");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${memberId}.${extension}`);
  await writeFile(file, bytes, { mode: 0o600 });
  return file;
}

async function avatarForUi(file) {
  if (!file) return null;
  try {
    const extension = path.extname(file).slice(1).toLowerCase();
    const mime = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension}`;
    return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
  } catch {
    return null;
  }
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function requiredId(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`App Server ${label} response is missing an id`);
  return value;
}
