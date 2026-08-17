import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = Object.freeze({ version: 2, revision: 0, teams: [] });

export class TeamStore {
  constructor(file) {
    this.file = file;
    this.commitQueue = Promise.resolve();
  }

  async read() {
    try {
      const state = JSON.parse(await readFile(this.file, "utf8"));
      assertState(state);
      return structuredClone(state);
    } catch (error) {
      if (error?.code === "ENOENT") return structuredClone(EMPTY_STATE);
      if (error instanceof SyntaxError) {
        throw new TeamStoreError("TEAM_DATA_INVALID", "teams.json contains invalid JSON", error);
      }
      throw error;
    }
  }

  async createTeam({ id, projectId, name, cwd }) {
    return this.#commit(async (state) => {
      const normalizedName = requireName(name, "Team");
      if (state.teams.some((team) => comparable(team.name) === comparable(normalizedName))) {
        throw new TeamStoreError("TEAM_NAME_CONFLICT", `Team already exists: ${normalizedName}`);
      }
      const teamId = String(id ?? "").trim();
      const nativeProjectId = String(projectId ?? "").trim();
      const cwdText = String(cwd ?? "").trim();
      if (!teamId || !nativeProjectId || !cwdText || !path.isAbsolute(cwdText)) {
        throw new TeamStoreError("TEAM_IDENTITY_REQUIRED", "Team id, projectId, and cwd are required");
      }
      const teamCwd = path.resolve(cwdText);
      const team = { id: teamId, projectId: nativeProjectId, name: normalizedName, cwd: teamCwd, members: [] };
      state.teams.push(team);
      return structuredClone(team);
    });
  }

  async updateTeam(teamId, input) {
    return this.#commit(async (state) => {
      const team = state.teams.find((candidate) => candidate.id === teamId);
      if (!team) throw new TeamStoreError("TEAM_NOT_FOUND", `Team not found: ${teamId}`);
      const name = input.name === undefined ? team.name : requireName(input.name, "Team");
      if (state.teams.some((candidate) =>
        candidate.id !== teamId && comparable(candidate.name) === comparable(name)
      )) {
        throw new TeamStoreError("TEAM_NAME_CONFLICT", `Team already exists: ${name}`);
      }
      team.name = name;
      return structuredClone(team);
    });
  }

  async removeTeam(teamId) {
    return this.#commit(async (state) => {
      const index = state.teams.findIndex((candidate) => candidate.id === teamId);
      if (index < 0) throw new TeamStoreError("TEAM_NOT_FOUND", `Team not found: ${teamId}`);
      const [team] = state.teams.splice(index, 1);
      return structuredClone(team);
    });
  }

  async addMember(teamId, input) {
    return this.#commit(async (state) => {
      const team = state.teams.find((candidate) => candidate.id === teamId);
      if (!team) throw new TeamStoreError("TEAM_NOT_FOUND", `Team not found: ${teamId}`);
      const name = requireName(input.name, "Member");
      if (team.members.some((member) => comparable(member.name) === comparable(name))) {
        throw new TeamStoreError("MEMBER_NAME_CONFLICT", `Member already exists: ${name}`);
      }
      const threadId = String(input.threadId ?? "").trim();
      if (!threadId) throw new TeamStoreError("THREAD_REQUIRED", "Member threadId is required");
      if (state.teams.some((candidate) => candidate.members.some((member) => member.threadId === threadId))) {
        throw new TeamStoreError("THREAD_BINDING_CONFLICT", `Thread is already bound: ${threadId}`);
      }
      const cwd = path.resolve(String(input.cwd ?? ""));
      const member = {
        id: input.id ?? randomUUID(),
        name,
        avatar: input.avatar ?? null,
        role: String(input.role ?? "").trim(),
        cwd,
        threadId,
        model: input.model ?? null,
        reasoningEffort: input.reasoningEffort ?? null
      };
      team.members.push(member);
      return structuredClone(member);
    });
  }

  async updateMember(teamId, memberId, input) {
    return this.#commit(async (state) => {
      const team = state.teams.find((candidate) => candidate.id === teamId);
      if (!team) throw new TeamStoreError("TEAM_NOT_FOUND", `Team not found: ${teamId}`);
      const index = team.members.findIndex((candidate) => candidate.id === memberId);
      if (index < 0) throw new TeamStoreError("MEMBER_NOT_FOUND", `Member not found: ${memberId}`);
      const current = team.members[index];
      const name = input.name === undefined ? current.name : requireName(input.name, "Member");
      if (team.members.some((member, memberIndex) =>
        memberIndex !== index && comparable(member.name) === comparable(name)
      )) {
        throw new TeamStoreError("MEMBER_NAME_CONFLICT", `Member already exists: ${name}`);
      }
      const updated = {
        ...current,
        name,
        role: input.role === undefined ? current.role : String(input.role).trim(),
        avatar: input.avatar === undefined ? current.avatar : input.avatar,
        model: input.model === undefined ? current.model : input.model || null,
        reasoningEffort: input.reasoningEffort === undefined
          ? current.reasoningEffort
          : input.reasoningEffort || null
      };
      team.members[index] = updated;
      return structuredClone(updated);
    });
  }

  async removeMember(teamId, memberId) {
    return this.#commit(async (state) => {
      const team = state.teams.find((candidate) => candidate.id === teamId);
      if (!team) throw new TeamStoreError("TEAM_NOT_FOUND", `Team not found: ${teamId}`);
      const index = team.members.findIndex((candidate) => candidate.id === memberId);
      if (index < 0) throw new TeamStoreError("MEMBER_NOT_FOUND", `Member not found: ${memberId}`);
      const [member] = team.members.splice(index, 1);
      return structuredClone(member);
    });
  }

  async replaceMemberThread(teamId, memberId, threadId) {
    return this.#commit(async (state) => {
      const team = state.teams.find((candidate) => candidate.id === teamId);
      if (!team) throw new TeamStoreError("TEAM_NOT_FOUND", `Team not found: ${teamId}`);
      const member = team.members.find((candidate) => candidate.id === memberId);
      if (!member) throw new TeamStoreError("MEMBER_NOT_FOUND", `Member not found: ${memberId}`);
      const replacement = String(threadId ?? "").trim();
      if (!replacement) throw new TeamStoreError("THREAD_REQUIRED", "Member threadId is required");
      if (state.teams.some((candidate) => candidate.members.some((bound) =>
        bound.id !== memberId && bound.threadId === replacement
      ))) {
        throw new TeamStoreError("THREAD_BINDING_CONFLICT", `Thread is already bound: ${replacement}`);
      }
      member.threadId = replacement;
      return structuredClone(member);
    });
  }

  async findMember(teamId, memberId) {
    const state = await this.read();
    const team = state.teams.find((candidate) => candidate.id === teamId);
    if (!team) throw new TeamStoreError("TEAM_NOT_FOUND", `Team not found: ${teamId}`);
    const member = team.members.find((candidate) => candidate.id === memberId);
    if (!member) throw new TeamStoreError("MEMBER_NOT_FOUND", `Member not found: ${memberId}`);
    return { team: structuredClone(team), member: structuredClone(member) };
  }

  async findTeam(teamId) {
    const state = await this.read();
    const team = state.teams.find((candidate) => candidate.id === teamId);
    if (!team) throw new TeamStoreError("TEAM_NOT_FOUND", `Team not found: ${teamId}`);
    return structuredClone(team);
  }

  #commit(change) {
    const operation = this.commitQueue.then(async () => {
      const state = await this.read();
      const value = await change(state);
      state.revision += 1;
      await this.#write(state);
      return value;
    });
    this.commitQueue = operation.catch(() => undefined);
    return operation;
  }

  async #write(state) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}

export class TeamStoreError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "TeamStoreError";
    this.code = code;
  }
}

function assertState(state) {
  if (
    state?.version !== 2 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.teams)
  ) {
    throw new TeamStoreError("TEAM_DATA_INVALID", "teams.json has an unsupported shape");
  }
  const teamIds = new Set();
  const teamNames = new Set();
  const memberIds = new Set();
  const threadIds = new Set();
  for (const team of state.teams) {
    if (
      !isText(team?.id) || !isText(team?.projectId) || !isText(team?.name) ||
      !isText(team?.cwd) || !path.isAbsolute(team.cwd) || !Array.isArray(team?.members)
    ) {
      throw new TeamStoreError("TEAM_DATA_INVALID", "teams.json contains an invalid Team");
    }
    const normalizedTeamName = comparable(team.name);
    if (teamIds.has(team.id) || teamNames.has(normalizedTeamName)) {
      throw new TeamStoreError("TEAM_DATA_INVALID", "teams.json contains duplicate Teams");
    }
    teamIds.add(team.id);
    teamNames.add(normalizedTeamName);
    const names = new Set();
    for (const member of team.members) {
      if (
        !isText(member?.id) || !isText(member?.name) || typeof member?.role !== "string" ||
        !isText(member?.cwd) || !path.isAbsolute(member.cwd) || !isText(member?.threadId) ||
        !(member.avatar === null || typeof member.avatar === "string") ||
        !(member.model === null || typeof member.model === "string") ||
        !(member.reasoningEffort === null || typeof member.reasoningEffort === "string")
      ) {
        throw new TeamStoreError("TEAM_DATA_INVALID", "teams.json contains an invalid Member");
      }
      const normalizedMemberName = comparable(member.name);
      if (
        memberIds.has(member.id) || threadIds.has(member.threadId) || names.has(normalizedMemberName)
      ) {
        throw new TeamStoreError("TEAM_DATA_INVALID", "teams.json contains duplicate Members or Threads");
      }
      memberIds.add(member.id);
      threadIds.add(member.threadId);
      names.add(normalizedMemberName);
    }
  }
}

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requireName(value, label) {
  const name = String(value ?? "").trim();
  if (!name) throw new TeamStoreError("NAME_REQUIRED", `${label} name is required`);
  return name;
}

function comparable(value) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}
