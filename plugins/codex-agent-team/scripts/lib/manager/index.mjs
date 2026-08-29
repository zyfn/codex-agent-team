import { randomUUID } from "node:crypto";
import { mkdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import { acquireFileLease } from "../file-lease.mjs";
import { avatarForUi, isManagedAvatar, saveAvatar } from "./avatars.mjs";
import { createCodexAdapter } from "./codex-adapter.mjs";
import {
  messageLeaseFile,
  resolveCollaborationContext,
  resolveMessageRoute,
} from "./collaboration.mjs";
import { normalizeName } from "./store.mjs";
import { createMemberDirectory, inspectGitSource } from "./member-directory.mjs";

export function createCodexAgentTeamManager({
  store,
  rpc,
  codexAdapter = null,
  teamsRoot,
  dataRoot = path.dirname(teamsRoot),
  navigation = null,
  desktopTeams = null,
  acquireMessageLease = acquireFileLease,
  delayImpl = delay,
  rolloutReadyTimeoutMs = 10_000,
  rolloutReadyPollMs = 50,
}) {
  const codex = codexAdapter ?? createCodexAdapter({
    rpc,
    navigation,
    desktopTeams,
    delay: delayImpl,
    rolloutReadyTimeoutMs,
    rolloutReadyPollMs,
  });
  let ownedThreadIds = null;
  const avatarCache = new Map();

  return {
    execute,
    snapshot,
    restoreDesktopProjection,
    ownsNotification,
    collaborationContext,
    collaborate,
    readTeam,
  };

  async function execute(command) {
    switch (command?.type) {
      case "inspectWorkingDirectory":
        return inspectGitSource(requiredText(command.path, "Git repository"));
      case "createTeam":
        return createTeam(command);
      case "renameTeam":
        return renameTeam(command);
      case "removeTeam":
        return removeTeam(command.teamId);
      case "createMember":
        return createMember(command);
      case "updateMember":
        return updateMember(command);
      case "removeMember":
        return removeMember(command.teamId, command.threadId);
      case "openMember":
        return openMember(command.teamId, command.threadId);
      default:
        throw new Error(`Unknown CodexAgentTeam command: ${String(command?.type)}`);
    }
  }

  async function createTeam(input) {
    const directoryKey = randomUUID();
    const name = validateName(input.name, "Team");
    const teamDirectory = path.join(teamsRoot, directoryKey);
    const sharedDirectory = path.join(teamDirectory, "shared");
    await mkdir(sharedDirectory, { recursive: true, mode: 0o700 });
    let native = null;
    try {
      native = await codex.createTeam(
        { name, teamDirectory },
        { idempotencyKey: `codex-agent-team:create:${directoryKey}` },
      );
      const record = await store.createTeam({
        teamId: native.teamId,
        teamDirectory,
      });
      return teamView(record, native);
    } catch (error) {
      const cleanupErrors = [];
      if (native) {
        await codex.removeTeam({ ...native, teamDirectory })
          .catch((cleanupError) => cleanupErrors.push(cleanupError));
      }
      await rmdir(sharedDirectory).catch((cleanupError) => {
        if (cleanupError?.code !== "ENOENT") cleanupErrors.push(cleanupError);
      });
      await rmdir(teamDirectory).catch((cleanupError) => {
        if (cleanupError?.code !== "ENOENT") cleanupErrors.push(cleanupError);
      });
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], "Team creation and cleanup both failed");
      }
      throw error;
    }
  }

  async function renameTeam(input) {
    const teamId = requiredText(input.teamId, "Team id");
    const record = await store.findTeam(teamId);
    const native = await codex.renameTeam(
      teamId,
      validateName(input.name, "Team"),
      record.teamDirectory,
    );
    return teamView(record, native);
  }

  async function removeTeam(teamIdValue) {
    const teamId = requiredText(teamIdValue, "Team id");
    const native = (await codex.listTeams()).find((team) => team.teamId === teamId) ?? null;
    const record = await store.removeTeam(teamId);
    try {
      if (native) await codex.removeTeam({ ...native, teamDirectory: record.teamDirectory });
    } catch (error) {
      const rollbackErrors = [];
      await store.restoreTeam(record).catch((rollbackError) => rollbackErrors.push(rollbackError));
      if (rollbackErrors.length) {
        throw new AggregateError([error, ...rollbackErrors], "Team removal and rollback both failed");
      }
      throw error;
    }
    for (const member of record.members) {
      ownedThreadIds?.delete(member.threadId);
      if (member.avatar) avatarCache.delete(member.avatar);
    }
    return {
      removed: record,
      preserved: {
        threadIds: record.members.map((member) => member.threadId),
        paths: [record.teamDirectory],
      },
    };
  }

  async function snapshot() {
    const state = await store.read();
    const threadIds = new Set(state.teams.flatMap((team) => team.members.map((member) => member.threadId)));
    ownedThreadIds = threadIds;
    const [threadResult, teamResult, availableModels] = await Promise.all([
      codex.readMemberSummaries(threadIds)
        .then((summaries) => ({ summaries, connected: true }))
        .catch(() => ({ summaries: new Map(), connected: false })),
      codex.listTeams()
        .then((teams) => ({ teams, connected: true }))
        .catch(() => ({ teams: [], connected: false })),
      codex.listAvailableModels(),
    ]);
    const nativeTeams = new Map(teamResult.teams.map((team) => [team.teamId, team]));
    return {
      version: state.version,
      connectionStatus: threadResult.connected && teamResult.connected ? "connected" : "disconnected",
      availableModels,
      teams: await Promise.all(state.teams.map(async (record) => ({
        ...teamView(record, nativeTeams.get(record.teamId)),
        members: await Promise.all(record.members.map(async (member) => memberView(
          member,
          threadResult.summaries.get(member.threadId),
          await avatarForUi(member.avatar, avatarCache, dataRoot),
        ))),
      }))),
    };
  }

  async function restoreDesktopProjection() {
    const state = await store.read();
    const nativeTeams = new Map((await codex.listTeams()).map((team) => [team.teamId, team]));
    const members = state.teams.flatMap((team) => team.members);
    const summaries = await codex.readMemberSummaries(
      new Set(members.map((member) => member.threadId)),
    );
    let missingTeams = 0;
    let assignmentsUpdated = 0;
    for (const record of state.teams) {
      await mkdir(sharedDirectory(record), { recursive: true, mode: 0o700 });
      const native = nativeTeams.get(record.teamId);
      if (!native) {
        missingTeams += 1;
        continue;
      }
      assignmentsUpdated += await codex.restoreDesktopTeam(record, native, summaries);
    }
    return { missingTeams, assignmentsUpdated };
  }

  async function ownsNotification(params) {
    const threadId = notificationThreadId(params);
    if (!threadId) return false;
    if (!ownedThreadIds) {
      const state = await store.read();
      ownedThreadIds = new Set(state.teams.flatMap((team) => team.members.map((member) => member.threadId)));
    }
    return ownedThreadIds.has(threadId);
  }

  async function createMember(input) {
    const teamId = requiredText(input.teamId, "Team id");
    const record = await store.findTeam(teamId);
    const name = validateName(input.name, "Member");
    if (record.members.some((member) => normalizeName(member.name) === normalizeName(name))) {
      throw new Error(`Member already exists: ${name}`);
    }
    const operationId = randomUUID();
    let directory = null;
    let threadId = null;
    let avatar = null;
    try {
      directory = await createMemberDirectory({
        teamDirectory: record.teamDirectory,
        operationId,
        memberName: name,
        localGitDirectory: input.localGitDirectory ?? null,
        remoteGitUrl: input.remoteGitUrl ?? null,
      });
      avatar = input.avatarDataUrl
        ? await saveAvatar(dataRoot, operationId, input.avatarDataUrl)
        : (input.avatar ?? null);
      const draft = {
        name,
        role: validateRole(input.role),
        cwd: directory.cwd,
        model: input.model ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
      };
      threadId = await codex.createMemberThread(record, draft);
      const member = { name, role: draft.role, avatar, threadId };
      const stored = await store.addMember(teamId, member);
      ownedThreadIds?.add(threadId);
      return memberView(stored, { cwd: directory.cwd }, avatar);
    } catch (error) {
      const cleanupErrors = [];
      if (threadId) await codex.deleteThread(threadId).catch((value) => cleanupErrors.push(value));
      if (avatar && isManagedAvatar(dataRoot, avatar)) {
        await rm(avatar, { force: true }).catch((value) => cleanupErrors.push(value));
      }
      if (directory) await directory.cleanup().catch((value) => cleanupErrors.push(value));
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], "Member creation and cleanup both failed");
      }
      throw error;
    }
  }

  async function updateMember(input) {
    const found = await store.findMember(input.teamId, input.threadId);
    const next = {
      ...found.member,
      name: validateName(input.name, "Member"),
      role: validateRole(input.role),
    };
    let avatar;
    let applied = false;
    try {
      await codex.updateMemberThread(found.member, next);
      applied = true;
      avatar = input.avatarDataUrl
        ? await saveAvatar(dataRoot, input.threadId, input.avatarDataUrl)
        : input.avatar;
      const updated = await store.updateMember(input.teamId, input.threadId, {
        name: next.name,
        role: next.role,
        ...(avatar !== undefined ? { avatar } : {}),
      });
      if (
        found.member.avatar && found.member.avatar !== updated.avatar &&
        isManagedAvatar(dataRoot, found.member.avatar)
      ) {
        await rm(found.member.avatar, { force: true }).catch(() => undefined);
        avatarCache.delete(found.member.avatar);
      }
      return updated;
    } catch (error) {
      if (applied) await codex.updateMemberThread(next, found.member).catch(() => undefined);
      if (avatar && avatar !== found.member.avatar && isManagedAvatar(dataRoot, avatar)) {
        await rm(avatar, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  async function removeMember(teamId, threadId) {
    const { team, member } = await store.findMember(teamId, threadId);
    await codex.archiveMember(team, member);
    try {
      const removed = await store.removeMember(teamId, threadId);
      ownedThreadIds?.delete(removed.threadId);
      if (removed.avatar) avatarCache.delete(removed.avatar);
      return { removed, archived: true, preserved: { threadId: removed.threadId } };
    } catch (error) {
      const rollbackErrors = [];
      await codex.restoreMember(team, member).catch((value) => rollbackErrors.push(value));
      if (rollbackErrors.length) {
        throw new AggregateError([error, ...rollbackErrors], "Member removal and rollback both failed");
      }
      throw error;
    }
  }

  async function openMember(teamId, threadId) {
    const { member } = await store.findMember(teamId, threadId);
    await codex.openThread(member.threadId);
    return member;
  }

  async function collaborationContext(input) {
    const state = await store.read();
    const nativeTeams = new Map((await codex.listTeams()).map((team) => [team.teamId, team]));
    const summaries = await memberSummaries(state);
    return resolveCollaborationContext({
      ...state,
      teams: state.teams.map((record) => hydrateTeam(record, nativeTeams.get(record.teamId), summaries)),
    }, input);
  }

  async function collaborate(input) {
    const message = validateMessage(input.message);
    const state = await store.read();
    let routingState = state;
    if (!input.sourceThreadId && input.cwd) {
      const summaries = await memberSummaries(state);
      routingState = {
        ...state,
        teams: state.teams.map((team) => hydrateTeam(team, null, summaries)),
      };
    }
    if (input.team) {
      const nativeTeams = new Map((await codex.listTeams()).map((team) => [team.teamId, team]));
      routingState = {
        ...routingState,
        teams: routingState.teams.map((team) => ({
          ...team,
          name: nativeTeams.get(team.teamId)?.name ?? team.name,
        })),
      };
    }
    const route = resolveMessageRoute(routingState, input);
    const lease = await acquireMessageLease(
      messageLeaseFile({ runRoot: path.join(dataRoot, "run") }, route.targetThreadId),
      { busyMessage: `Another message to ${route.targetName} is still being submitted` },
    );
    try {
      const { member } = await store.findMember(route.teamId, route.targetThreadId);
      const text = [
        "CodexAgentTeam message",
        `From: ${requiredText(route.sourceName, "Source member")}`,
        "",
        message,
      ].join("\n");
      const receipt = await codex.sendMemberMessage(member, text);
      return { ...receipt, target: route.targetName };
    } finally {
      await lease.release();
    }
  }

  async function readTeam(teamId) {
    const record = await store.findTeam(teamId);
    const native = (await codex.listTeams()).find((team) => team.teamId === teamId);
    const summaries = await codex.readMemberSummaries(
      new Set(record.members.map((member) => member.threadId)),
    );
    return hydrateTeam(record, native, summaries);
  }

  async function memberSummaries(state) {
    return codex.readMemberSummaries(new Set(
      state.teams.flatMap((team) => team.members.map((member) => member.threadId)),
    ));
  }
}

function teamView(record, native) {
  return {
    ...record,
    name: typeof native?.name === "string" && native.name.trim()
      ? native.name.trim()
      : "Team unavailable",
    available: Boolean(native),
    sharedDirectory: sharedDirectory(record),
  };
}

function hydrateTeam(record, native, summaries) {
  return {
    ...teamView(record, native),
    members: record.members.map((member) => memberView(
      member,
      summaries.get(member.threadId),
      member.avatar,
    )),
  };
}

function memberView(member, summary, avatar) {
  return {
    ...member,
    avatar,
    cwd: typeof summary?.cwd === "string" ? summary.cwd : null,
    status: runtimeStatus(summary),
  };
}

function sharedDirectory(team) {
  return path.join(team.teamDirectory, "shared");
}

function runtimeStatus(summary) {
  if (!summary) return "offline";
  if (summary.status?.type === "systemError") return "error";
  if (summary.status?.type !== "active") return "idle";
  const flags = summary.status.activeFlags ?? [];
  if (flags.includes("waitingOnApproval") || flags.includes("waitingOnUserInput")) return "waiting";
  return "running";
}

function validateName(value, label) {
  const name = requiredText(value, `${label} name`);
  if (name.length > 80 || /[\u0000-\u001F\u007F]/.test(name)) {
    throw new Error(`${label} name must be 80 characters or fewer and contain no control characters`);
  }
  return name;
}

function validateRole(value) {
  const role = String(value ?? "").trim();
  if (role.length > 4000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(role)) {
    throw new Error("Member role must be 4000 characters or fewer and contain no control characters");
  }
  return role;
}

function validateMessage(value) {
  const message = requiredText(value, "Message");
  if (message.length > 32_000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(message)) {
    throw new Error("Team message must be 32000 characters or fewer and contain no control characters");
  }
  return message;
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function notificationThreadId(value, depth = 0) {
  if (depth > 4 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = notificationThreadId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const key of ["threadId", "thread_id", "conversationId", "conversation_id"]) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }
  for (const item of Object.values(value)) {
    const found = notificationThreadId(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
