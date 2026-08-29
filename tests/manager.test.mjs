import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCodexAgentTeamManager } from "../plugins/codex-agent-team/scripts/lib/manager/index.mjs";
import { buildMemberInstructions } from "../plugins/codex-agent-team/scripts/lib/manager/codex-adapter.mjs";
import { createTeamStore } from "../plugins/codex-agent-team/scripts/lib/manager/store.mjs";

test("creating a Team and member uses native Codex identity and an independent member directory", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-manager-"));
  const calls = [];
  const desktopCalls = [];
  const manager = createCodexAgentTeamManager({
    store: createTeamStore(path.join(home, "teams.json")),
    rpc: rpcStub(calls, {
      "project/create": ({ name, roots }) => ({ project: { id: "team-native", name, roots } }),
      "thread/start": () => ({ thread: { id: "thread-frontend" } }),
      "turn/start": () => ({ turn: { id: "turn-initialize" } }),
      "thread/read": () => ({ thread: { id: "thread-frontend" } }),
    }),
    teamsRoot: path.join(home, "teams"),
    desktopTeams: {
      async upsert(value) { desktopCalls.push(["upsert", value]); },
      async assign(value) { desktopCalls.push(["assign", value]); },
      async unassign(value) { desktopCalls.push(["unassign", value]); },
      async remove(value) { desktopCalls.push(["remove", value]); },
    },
  });

  const team = await manager.execute({ type: "createTeam", name: "Commercialization" });
  const member = await manager.execute({
    type: "createMember",
    teamId: team.teamId,
    name: "Frontend",
    role: "Own the UI",
  });

  assert.equal(team.teamId, "team-native");
  assert.equal(path.dirname(team.teamDirectory), path.join(home, "teams"));
  assert.equal(member.cwd, path.join(team.teamDirectory, "members", "Frontend"));
  await access(member.cwd);
  assert.deepEqual(calls.map(({ method }) => method), [
    "project/create",
    "thread/start",
    "turn/start",
    "thread/read",
    "thread/name/set",
  ]);
  const initialization = calls.find(({ method }) => method === "turn/start").params.input[0].text;
  assert.match(initialization, /confirm that you are ready/i);
  assert.doesNotMatch(initialization, /one[- ]hop|broadcast|forward|reply loop/i);
  assert.deepEqual(desktopCalls.map(([method]) => method), ["upsert", "assign"]);
  const stored = JSON.parse(await readFile(path.join(home, "teams.json"), "utf8"));
  assert.deepEqual(Object.keys(stored.teams[0]).sort(), [
    "members",
    "teamDirectory",
    "teamId",
  ]);
});

test("member instructions make Team collaboration direct without exposing internal routing policy", () => {
  const instructions = buildMemberInstructions({ name: "Frontend", role: "Own the UI" });

  assert.match(instructions, /Use \$codex-agent-team:collaborate when this work needs another Team member/);
  assert.match(instructions, /Team messages are ordinary work context/);
  assert.doesNotMatch(instructions, /one[- ]hop|broadcast|auto-forward|exactly one|reply loop/i);
});

test("renaming a Team updates the native Codex Team and no Store field", async () => {
  const calls = [];
  const manager = createCodexAgentTeamManager({
    store: {
      async findTeam(teamId) {
        calls.push(["find", teamId]);
        return teamRecord(teamId);
      },
    },
    codexAdapter: {
      async renameTeam(teamId, name, teamDirectory) {
        calls.push(["rename", teamId, name, teamDirectory]);
        return { teamId, name, roots: [{ path: teamDirectory }] };
      },
    },
    teamsRoot: "/tmp/unused",
  });

  const result = await manager.execute({ type: "renameTeam", teamId: "team-1", name: "Renamed" });

  assert.equal(result.name, "Renamed");
  assert.deepEqual(calls, [
    ["find", "team-1"],
    ["rename", "team-1", "Renamed", "/tmp/team-1"],
  ]);
});

test("collaboration context includes the current native Team name", async () => {
  const manager = createCodexAgentTeamManager({
    store: collaborationStore(),
    codexAdapter: {
      async listTeams() { return [{ teamId: "team-1", name: "Renamed Team", roots: [] }]; },
      async readMemberSummaries() {
        return new Map([
          ["thread-frontend", { id: "thread-frontend", cwd: "/tmp/frontend" }],
          ["thread-backend", { id: "thread-backend", cwd: "/tmp/backend" }],
        ]);
      },
    },
    teamsRoot: "/tmp/unused",
  });

  const context = await manager.collaborationContext({ sourceThreadId: "thread-frontend" });

  assert.equal(context.team.teamId, "team-1");
  assert.equal(context.team.name, "Renamed Team");
  assert.equal(context.team.sharedDirectory, "/tmp/team-1/shared");
  assert.deepEqual(context.peers.map(({ name }) => name), ["Backend"]);
});

test("sending to a member submits exactly one native Turn without reading Team metadata", async () => {
  const calls = [];
  const manager = createCodexAgentTeamManager({
    store: collaborationStore(),
    rpc: rpcStub(calls, {
      "turn/start": () => ({ turn: { id: "turn-message" } }),
    }),
    teamsRoot: "/tmp/unused",
    acquireMessageLease: async () => ({ async release() {} }),
  });

  const receipt = await manager.collaborate({
    sourceThreadId: "thread-frontend",
    target: "Backend",
    message: "Please check the API.",
  });

  assert.deepEqual(calls.map(({ method }) => method), ["turn/start"]);
  assert.equal(calls[0].params.threadId, "thread-backend");
  assert.match(calls[0].params.input[0].text, /From: Frontend/);
  assert.deepEqual(receipt, {
    accepted: true,
    threadId: "thread-backend",
    turnId: "turn-message",
    target: "Backend",
  });
});

test("sending to a busy member steers its current native Turn", async () => {
  const calls = [];
  const manager = createCodexAgentTeamManager({
    store: collaborationStore(),
    rpc: rpcStub(calls, {
      "turn/start": () => { throw new Error("thread already has an active or pending turn"); },
      "thread/read": () => ({
        thread: {
          id: "thread-backend",
          turns: [
            { id: "turn-old", status: "completed", items: [] },
            { id: "turn-active", status: "inProgress", items: [] },
          ],
        },
      }),
      "turn/steer": () => ({ turnId: "turn-active" }),
    }),
    teamsRoot: "/tmp/unused",
    acquireMessageLease: async () => ({ async release() {} }),
  });

  const receipt = await manager.collaborate({
    sourceThreadId: "thread-frontend",
    target: "Backend",
    message: "Please include this in your current work.",
  });

  assert.deepEqual(calls.map(({ method }) => method), ["turn/start", "thread/read", "turn/steer"]);
  assert.equal(calls[1].params.includeTurns, true);
  assert.equal(calls[2].params.expectedTurnId, "turn-active");
  assert.equal(calls[2].params.threadId, "thread-backend");
  assert.deepEqual(receipt, {
    accepted: true,
    threadId: "thread-backend",
    turnId: "turn-active",
    target: "Backend",
  });
});

test("Dashboard snapshots read native Team names and member runtime without resuming Threads", async () => {
  const calls = [];
  const manager = createCodexAgentTeamManager({
    store: collaborationStore(),
    rpc: rpcStub(calls, {
      "project/list": () => ({
        data: [{ id: "team-1", name: "Native Team", roots: [{ path: "/tmp/team-1" }] }],
        nextCursor: null,
      }),
      "thread/list": () => ({
        data: [
          { id: "thread-frontend", cwd: "/tmp/frontend", status: { type: "active", activeFlags: [] } },
          { id: "thread-backend", cwd: "/tmp/backend", status: { type: "active", activeFlags: ["waitingOnApproval"] } },
        ],
        nextCursor: null,
      }),
      "model/list": () => ({ data: [], nextCursor: null }),
    }),
    teamsRoot: "/tmp/unused",
  });

  const snapshot = await manager.snapshot();

  assert.equal(snapshot.teams[0].name, "Native Team");
  assert.deepEqual(snapshot.teams[0].members.map(({ status }) => status), ["running", "waiting"]);
  assert.equal(calls.some(({ method }) => method === "thread/resume"), false);
});

test("Desktop projection restores only registered native Teams and stale member assignments", async () => {
  const calls = [];
  const manager = createCodexAgentTeamManager({
    store: collaborationStore(),
    codexAdapter: {
      async listTeams() { return [{ teamId: "team-1", name: "Native Team", roots: [] }]; },
      async readMemberSummaries() { return new Map(); },
      async restoreDesktopTeam(team, native) {
        calls.push([team.teamId, native.name]);
        return 1;
      },
    },
    teamsRoot: "/tmp/unused",
  });

  assert.deepEqual(await manager.restoreDesktopProjection(), {
    missingTeams: 0,
    assignmentsUpdated: 1,
  });
  assert.deepEqual(calls, [["team-1", "Native Team"]]);
});

test("removing a member archives its native Thread without owning cwd metadata", async () => {
  const calls = [];
  const member = memberRecord("Backend", "thread-backend");
  const manager = createCodexAgentTeamManager({
    store: {
      async findMember() { return { team: teamRecord("team-1", [member]), member }; },
      async removeMember(teamId, threadId) {
        calls.push(["store", teamId, threadId]);
        return member;
      },
    },
    codexAdapter: {
      async archiveMember(team, target) { calls.push(["archive", team.teamId, target.threadId]); },
    },
    teamsRoot: "/tmp/unused",
  });

  const result = await manager.execute({ type: "removeMember", teamId: "team-1", threadId: member.threadId });

  assert.equal(result.archived, true);
  assert.deepEqual(result.preserved, { threadId: "thread-backend" });
  assert.deepEqual(calls, [
    ["archive", "team-1", "thread-backend"],
    ["store", "team-1", "thread-backend"],
  ]);
});

test("editing a member replaces native instructions without creating a visible Turn", async () => {
  const calls = [];
  const member = memberRecord("Backend", "thread-backend");
  const manager = createCodexAgentTeamManager({
    store: {
      async findMember() { return { team: teamRecord("team-1", [member]), member }; },
      async updateMember(teamId, threadId, input) {
        calls.push(["store", teamId, threadId, input]);
        return { ...member, ...input };
      },
    },
    codexAdapter: {
      async updateMemberThread(previous, next) { calls.push(["native", previous.name, next.name]); },
    },
    teamsRoot: "/tmp/unused",
  });

  const updated = await manager.execute({
    type: "updateMember",
    teamId: "team-1",
    threadId: member.threadId,
    name: "Platform",
    role: "Own platform APIs",
  });

  assert.equal(updated.name, "Platform");
  assert.deepEqual(calls[0], ["native", "Backend", "Platform"]);
});

test("removing a Team preserves member Threads and directory paths", async () => {
  const record = teamRecord("team-1", [
    memberRecord("Backend", "thread-1"),
  ]);
  const calls = [];
  const manager = createCodexAgentTeamManager({
    store: {
      async removeTeam(teamId) { calls.push(["store", teamId]); return record; },
    },
    codexAdapter: {
      async listTeams() { return [{ teamId: "team-1", name: "Native Team", roots: [] }]; },
      async removeTeam(team) { calls.push(["native", team.teamId]); },
    },
    teamsRoot: "/tmp/unused",
  });

  const result = await manager.execute({ type: "removeTeam", teamId: "team-1" });

  assert.deepEqual(result.preserved.threadIds, ["thread-1"]);
  assert.deepEqual(result.preserved.paths, ["/tmp/team-1"]);
  assert.deepEqual(calls, [["store", "team-1"], ["native", "team-1"]]);
});

function collaborationStore() {
  const team = teamRecord("team-1", [
    memberRecord("Frontend", "thread-frontend", "Own the UI"),
    memberRecord("Backend", "thread-backend", "Own the API"),
  ]);
  return {
    async read() { return { version: 1, teams: [structuredClone(team)] }; },
    async findMember(teamId, threadId) {
      assert.equal(teamId, team.teamId);
      const member = team.members.find((candidate) => candidate.threadId === threadId);
      assert.ok(member);
      return { team: structuredClone(team), member: structuredClone(member) };
    },
  };
}

function teamRecord(teamId, members = []) {
  return {
    teamId,
    teamDirectory: `/tmp/${teamId}`,
    members,
  };
}

function memberRecord(name, threadId, role = "") {
  return {
    name,
    role,
    threadId,
    avatar: null,
  };
}

function rpcStub(calls, handlers) {
  return {
    async request(method, params) {
      calls.push({ method, params });
      const handler = handlers[method];
      if (handler) return handler(params ?? {});
      return {};
    },
  };
}
