import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { acquireFileLease } from "../file-lease.mjs";

const CURRENT_VERSION = 1;
const EMPTY_STATE = Object.freeze({ version: CURRENT_VERSION, teams: [] });

export function createTeamStore(file) {
  let commitQueue = Promise.resolve();

  async function read() {
    const state = await readStoredState({ allowMissing: true });
    assertState(state);
    return structuredClone(state);
  }

  async function readStoredState({ allowMissing = false } = {}) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (allowMissing && error?.code === "ENOENT") return structuredClone(EMPTY_STATE);
      if (error instanceof SyntaxError) {
        throw storeError("TEAM_DATA_INVALID", "teams.json contains invalid JSON", error);
      }
      throw error;
    }
  }

  function commit(change) {
    const operation = commitQueue.then(async () => {
      const lease = await acquireFileLease(`${file}.lock`, {
        busyError: () => storeError("TEAM_DATA_BUSY", "teams.json is busy; try again"),
      });
      try {
        const state = await readStoredState({ allowMissing: true });
        assertState(state);
        const value = await change(state);
        assertState(state);
        await write(state);
        return value;
      } finally {
        await lease.release();
      }
    });
    commitQueue = operation.catch(() => undefined);
    return operation;
  }

  async function write(state) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
  }

  return {
    read,
    createTeam({ teamId, teamDirectory }) {
      return commit(async (state) => {
        const id = required(teamId, "Team id");
        const directory = requiredAbsolutePath(teamDirectory, "Team directory");
        if (state.teams.some((team) => team.teamId === id)) {
          throw storeError("TEAM_ID_CONFLICT", `Team is already registered: ${id}`);
        }
        const team = { teamId: id, teamDirectory: directory, members: [] };
        state.teams.push(team);
        return structuredClone(team);
      });
    },
    removeTeam(teamId) {
      return commit(async (state) => {
        const index = state.teams.findIndex((team) => team.teamId === teamId);
        if (index < 0) throw storeError("TEAM_NOT_FOUND", `Team not found: ${teamId}`);
        const [team] = state.teams.splice(index, 1);
        return structuredClone(team);
      });
    },
    restoreTeam(input) {
      return commit(async (state) => {
        const team = structuredClone(input);
        if (state.teams.some((candidate) => candidate.teamId === team.teamId)) {
          throw storeError("TEAM_ID_CONFLICT", `Team is already registered: ${team.teamId}`);
        }
        state.teams.push(team);
        return structuredClone(team);
      });
    },
    addMember(teamId, input) {
      return commit(async (state) => {
        const team = findTeam(state, teamId);
        const name = requireName(input.name, "Member");
        const threadId = required(input.threadId, "Thread id");
        if (team.members.some((member) => normalizeName(member.name) === normalizeName(name))) {
          throw storeError("MEMBER_NAME_CONFLICT", `Member already exists: ${name}`);
        }
        if (state.teams.some((candidate) =>
          candidate.members.some((member) => member.threadId === threadId)
        )) {
          throw storeError("THREAD_BINDING_CONFLICT", `Thread is already bound: ${threadId}`);
        }
        const member = {
          threadId,
          name,
          role: String(input.role ?? "").trim(),
          avatar: input.avatar ?? null,
        };
        team.members.push(member);
        return structuredClone(member);
      });
    },
    updateMember(teamId, threadId, input) {
      return commit(async (state) => {
        const team = findTeam(state, teamId);
        const index = team.members.findIndex((member) => member.threadId === threadId);
        if (index < 0) throw storeError("MEMBER_NOT_FOUND", `Member not found: ${threadId}`);
        const current = team.members[index];
        const name = input.name === undefined ? current.name : requireName(input.name, "Member");
        if (team.members.some((member, memberIndex) =>
          memberIndex !== index && normalizeName(member.name) === normalizeName(name)
        )) {
          throw storeError("MEMBER_NAME_CONFLICT", `Member already exists: ${name}`);
        }
        const updated = {
          ...current,
          name,
          role: input.role === undefined ? current.role : String(input.role).trim(),
          avatar: input.avatar === undefined ? current.avatar : input.avatar,
        };
        team.members[index] = updated;
        return structuredClone(updated);
      });
    },
    removeMember(teamId, threadId) {
      return commit(async (state) => {
        const team = findTeam(state, teamId);
        const index = team.members.findIndex((member) => member.threadId === threadId);
        if (index < 0) throw storeError("MEMBER_NOT_FOUND", `Member not found: ${threadId}`);
        const [member] = team.members.splice(index, 1);
        return structuredClone(member);
      });
    },
    async findMember(teamId, threadId) {
      const state = await read();
      const team = findTeam(state, teamId);
      const member = team.members.find((candidate) => candidate.threadId === threadId);
      if (!member) throw storeError("MEMBER_NOT_FOUND", `Member not found: ${threadId}`);
      return { team: structuredClone(team), member: structuredClone(member) };
    },
    async findTeam(teamId) {
      const state = await read();
      return structuredClone(findTeam(state, teamId));
    },
  };
}

function assertState(state) {
  if (state?.version !== CURRENT_VERSION || !Array.isArray(state.teams)) {
    throw storeError("TEAM_DATA_INVALID", "teams.json has an unsupported shape");
  }
  const teamIds = new Set();
  const threadIds = new Set();
  for (const team of state.teams) {
    if (!isText(team?.teamId) || !isText(team?.teamDirectory) ||
      !path.isAbsolute(team.teamDirectory) || !Array.isArray(team.members)) {
      throw storeError("TEAM_DATA_INVALID", "teams.json contains an invalid Team");
    }
    if (teamIds.has(team.teamId)) throw storeError("TEAM_DATA_INVALID", "teams.json contains duplicate Teams");
    teamIds.add(team.teamId);
    const names = new Set();
    for (const member of team.members) {
      if (!isText(member?.threadId) || !isText(member?.name) || typeof member?.role !== "string" ||
        !(member.avatar === null || typeof member.avatar === "string")) {
        throw storeError("TEAM_DATA_INVALID", "teams.json contains an invalid Member");
      }
      const normalizedName = normalizeName(member.name);
      if (threadIds.has(member.threadId) || names.has(normalizedName)) {
        throw storeError("TEAM_DATA_INVALID", "teams.json contains duplicate Members or Threads");
      }
      threadIds.add(member.threadId);
      names.add(normalizedName);
    }
  }
}

function findTeam(state, teamId) {
  const team = state.teams.find((candidate) => candidate.teamId === teamId);
  if (!team) throw storeError("TEAM_NOT_FOUND", `Team not found: ${teamId}`);
  return team;
}

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw storeError("VALUE_REQUIRED", `${label} is required`);
  return text;
}

function requiredAbsolutePath(value, label) {
  const text = required(value, label);
  if (!path.isAbsolute(text)) throw storeError("PATH_INVALID", `${label} must be absolute`);
  return path.resolve(text);
}

function requireName(value, label) {
  const name = required(value, `${label} name`);
  if (name.length > 80 || /[\u0000-\u001F\u007F]/.test(name)) {
    throw storeError("NAME_INVALID", `${label} name is invalid`);
  }
  return name;
}

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function storeError(code, message, cause) {
  return Object.assign(new Error(message, { cause }), { code });
}

export function normalizeName(value) {
  return value.normalize("NFKC").trim().toLowerCase();
}
