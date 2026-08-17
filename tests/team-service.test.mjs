import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TeamService } from "../scripts/lib/team-service.mjs";
import { TeamStore } from "../scripts/lib/team-store.mjs";

test("creating a member creates one durable native thread without sending a fake first turn", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-service-"));
  const calls = [];
  const nativeSyncs = [];
  const rpc = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/start") return { thread: { id: "thread-frontend" } };
      return {};
    }
  };
  const service = new TeamService({
    store: new TeamStore(path.join(home, "teams.json")),
    rpc,
    workspaceRoot: path.join(home, "workspaces"),
    projectAdapter: {
      async sync(teams) { nativeSyncs.push(structuredClone(teams)); }
    }
  });
  const team = await service.createTeam({ name: "商业化团队" });

  assert.equal(team.projectId, team.id);
  assert.equal(team.cwd, path.join(home, "workspaces", team.id));

  const member = await service.createMember({
    teamId: team.id,
    name: "前端",
    role: "负责前端体验",
    model: "gpt-5",
    reasoningEffort: "high"
  });

  assert.equal(member.threadId, "thread-frontend");
  assert.equal(member.cwd, path.join(team.cwd, "前端"));
  assert.deepEqual(calls.map((call) => call.method), ["thread/start", "thread/name/set"]);
  assert.match(calls[0].params.developerInstructions, /商业化团队/);
  assert.equal(nativeSyncs.length, 2);
  assert.equal(nativeSyncs[1][0].projectId, team.id);
  assert.equal(nativeSyncs[1][0].members[0].threadId, "thread-frontend");
});

test("sending to a running member steers its current turn", async () => {
  const calls = [];
  const rpc = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/resume") {
        return { thread: { status: { type: "active" }, turns: [{ id: "turn-live", status: "inProgress" }] } };
      }
      if (method === "turn/steer") return { turnId: "turn-live" };
      return {};
    }
  };
  const store = {
    async findMember() {
      return {
        team: { id: "team-1", name: "商业化团队" },
        member: { id: "member-2", name: "后端", cwd: "/tmp/backend", threadId: "thread-backend" }
      };
    }
  };
  const service = new TeamService({ store, rpc, workspaceRoot: "/tmp/unused" });

  const receipt = await service.sendMessage({
    teamId: "team-1",
    sourceName: "前端",
    targetMemberId: "member-2",
    message: "接口字段已更新，请同步。"
  });

  assert.deepEqual(calls.map((call) => call.method), ["thread/resume", "turn/steer"]);
  assert.equal(calls[1].params.expectedTurnId, "turn-live");
  assert.match(calls[1].params.input[0].text, /来自「前端」/);
  assert.deepEqual(receipt, { accepted: true, threadId: "thread-backend", turnId: "turn-live" });
});

test("opening a lost empty member thread recreates only that empty conversation", async () => {
  const calls = [];
  const rpc = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/resume") throw new Error("thread not found");
      if (method === "thread/start") return { thread: { id: "thread-replacement" } };
      return {};
    }
  };
  let rebound;
  const store = {
    async findMember() {
      return {
        team: { id: "team-1", name: "商业化团队" },
        member: {
          id: "member-1",
          name: "后端",
          role: "负责服务端",
          cwd: "/tmp/backend",
          threadId: "thread-empty"
        }
      };
    },
    async replaceMemberThread(teamId, memberId, threadId) {
      rebound = { teamId, memberId, threadId };
      return { id: memberId, threadId };
    }
  };
  const service = new TeamService({ store, rpc, workspaceRoot: "/tmp/unused" });

  const member = await service.openMember("team-1", "member-1");

  assert.deepEqual(calls.map((call) => call.method), [
    "thread/resume",
    "thread/start",
    "thread/name/set"
  ]);
  assert.deepEqual(rebound, {
    teamId: "team-1",
    memberId: "member-1",
    threadId: "thread-replacement"
  });
  assert.equal(member.threadId, "thread-replacement");
});

test("a transient resume failure never changes a member thread binding", async () => {
  const calls = [];
  const rpc = {
    async request(method) {
      calls.push(method);
      throw new Error("App Server daemon connection closed");
    }
  };
  let rebound = false;
  const store = {
    async findMember() {
      return {
        team: { id: "team-1", name: "商业化团队" },
        member: {
          id: "member-1",
          name: "后端",
          role: "负责服务端",
          cwd: "/tmp/backend",
          threadId: "thread-real"
        }
      };
    },
    async replaceMemberThread() { rebound = true; }
  };
  const service = new TeamService({ store, rpc, workspaceRoot: "/tmp/unused" });

  await assert.rejects(
    service.openMember("team-1", "member-1"),
    /daemon connection closed/
  );

  assert.deepEqual(calls, ["thread/resume"]);
  assert.equal(rebound, false);
});

test("native member navigation does not resume or mutate the conversation", async () => {
  const rpcCalls = [];
  const navigations = [];
  const member = {
    id: "member-1",
    name: "后端",
    cwd: "/tmp/backend",
    threadId: "thread-native"
  };
  const service = new TeamService({
    store: {
      async findMember() {
        return { team: { id: "team-1", name: "商业化团队" }, member };
      }
    },
    rpc: {
      async request(method, params) {
        rpcCalls.push({ method, params });
      }
    },
    workspaceRoot: "/tmp/unused",
    projectAdapter: {
      async openThread(threadId) { navigations.push(threadId); }
    }
  });

  const result = await service.navigateMember("team-1", "member-1");

  assert.equal(result, member);
  assert.deepEqual(navigations, ["thread-native"]);
  assert.deepEqual(rpcCalls, []);
});

test("the dashboard snapshot derives member runtime only from App Server thread status", async () => {
  const store = {
    async read() {
      return {
        version: 1,
        revision: 1,
        teams: [{
          id: "team-1",
          name: "商业化团队",
          members: [
            { id: "member-running", name: "前端", avatar: null, threadId: "thread-running" },
            { id: "member-waiting", name: "后端", avatar: null, threadId: "thread-waiting" },
            { id: "member-idle", name: "研究", avatar: null, threadId: "thread-idle" },
            { id: "member-missing", name: "运营", avatar: null, threadId: "thread-missing" }
          ]
        }]
      };
    }
  };
  const rpc = {
    async request(method) {
      assert.equal(method, "thread/list");
      return {
        data: [
          { id: "thread-running", status: { type: "active", activeFlags: [] }, updatedAt: 40 },
          { id: "thread-waiting", status: { type: "active", activeFlags: ["waitingOnApproval"] }, updatedAt: 30 },
          { id: "thread-idle", status: { type: "notLoaded" }, updatedAt: 20 }
        ],
        nextCursor: null
      };
    }
  };
  const service = new TeamService({ store, rpc, workspaceRoot: "/tmp/unused" });

  const snapshot = await service.snapshot();

  assert.equal(snapshot.connectionStatus, "connected");
  assert.deepEqual(snapshot.teams[0].members.map((member) => member.status), [
    "running",
    "waiting",
    "idle",
    "offline"
  ]);
});

test("the dashboard reports a disconnected adapter without inventing member activity", async () => {
  const store = {
    async read() {
      return {
        version: 1,
        revision: 1,
        teams: [{
          id: "team-1",
          name: "Platform",
          members: [{ id: "member-1", name: "Backend", avatar: null, threadId: "thread-1" }]
        }]
      };
    }
  };
  const rpc = {
    async request() {
      throw new Error("App Server daemon connection closed");
    }
  };
  const service = new TeamService({ store, rpc, workspaceRoot: "/tmp/unused" });

  const snapshot = await service.snapshot();

  assert.equal(snapshot.connectionStatus, "disconnected");
  assert.equal(snapshot.teams[0].members[0].status, "offline");
});

test("removing a member detaches its native Project assignment without deleting its Thread or workspace", async () => {
  const calls = [];
  const store = {
    async findMember() {
      return {
        team: { id: "team-1", projectId: "project-1", name: "商业化团队" },
        member: { id: "member-1", threadId: "thread-1", cwd: "/tmp/backend" }
      };
    },
    async removeMember(teamId, memberId) {
      calls.push(["store.removeMember", teamId, memberId]);
      return { id: memberId, threadId: "thread-1", cwd: "/tmp/backend" };
    }
  };
  const projectAdapter = {
    async removeMember(threadId) { calls.push(["adapter.removeMember", threadId]); }
  };
  const rpc = { async request(method) { calls.push(["rpc", method]); } };
  const service = new TeamService({ store, rpc, workspaceRoot: "/tmp/unused", projectAdapter });

  const result = await service.deleteMember("team-1", "member-1");

  assert.equal(result.preserved.threadId, "thread-1");
  assert.equal(result.preserved.cwd, "/tmp/backend");
  assert.deepEqual(calls, [
    ["adapter.removeMember", "thread-1"],
    ["store.removeMember", "team-1", "member-1"]
  ]);
});

test("removing a Team detaches its native Project while preserving every member Thread and workspace", async () => {
  const team = {
    id: "team-1",
    projectId: "project-1",
    name: "商业化团队",
    cwd: "/tmp/team-1",
    members: [{ id: "member-1", threadId: "thread-1", cwd: "/tmp/team-1/后端" }]
  };
  const calls = [];
  const store = {
    async findTeam() { return structuredClone(team); },
    async removeTeam(teamId) { calls.push(["store.removeTeam", teamId]); return structuredClone(team); }
  };
  const projectAdapter = {
    async removeTeam(value) { calls.push(["adapter.removeTeam", value.projectId]); }
  };
  const service = new TeamService({ store, rpc: {}, workspaceRoot: "/tmp/unused", projectAdapter });

  const result = await service.deleteTeam("team-1");

  assert.deepEqual(result.preserved.threadIds, ["thread-1"]);
  assert.deepEqual(result.preserved.cwds, ["/tmp/team-1", "/tmp/team-1/后端"]);
  assert.deepEqual(calls, [
    ["adapter.removeTeam", "project-1"],
    ["store.removeTeam", "team-1"]
  ]);
});
