import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  messageLeaseFile,
  resolveMemberContext,
  resolveMessageRoute
} from "../plugins/codex-agent-team/scripts/lib/manager/collaboration.mjs";

const snapshot = {
  teams: [{
    teamId: "team-1",
    name: "商业化团队",
    sharedDirectory: "/tmp/team/shared",
    members: [
      { name: "前端", role: "负责用户界面", cwd: "/tmp/team/frontend", threadId: "thread-front" },
      { name: "后端", role: "负责服务接口", cwd: "/tmp/team/backend", threadId: "thread-back" },
    ],
  }],
};

test("member context returns identity, responsibility, directory, and peers in one read", () => {
  assert.deepEqual(resolveMemberContext(snapshot, {
    cwd: "/tmp/team/frontend/src"
  }), {
    team: {
      teamId: "team-1",
      name: "商业化团队",
      sharedDirectory: "/tmp/team/shared",
    },
    self: { threadId: "thread-front", name: "前端", role: "负责用户界面", cwd: "/tmp/team/frontend" },
    peers: [{ threadId: "thread-back", name: "后端", role: "负责服务接口", cwd: "/tmp/team/backend" }]
  });
});

test("member communication resolves source by native thread and target inside the same Team", () => {
  assert.deepEqual(resolveMessageRoute(snapshot, {
    target: "后端",
    cwd: "/unrelated",
    sourceThreadId: "thread-front",
  }), {
    teamId: "team-1",
    sourceName: "前端",
    targetThreadId: "thread-back",
    targetName: "后端",
  });
});

test("member communication resolves source from a path inside the Member Directory", () => {
  assert.equal(resolveMessageRoute(snapshot, {
    target: "后端",
    cwd: "/tmp/team/frontend/src",
  }).sourceName, "前端");
});

test("unloaded member identity is never guessed from its display name", () => {
  const unloaded = structuredClone(snapshot);
  unloaded.teams[0].teamDirectory = "/tmp/team";
  for (const member of unloaded.teams[0].members) delete member.cwd;

  assert.throws(() => resolveMessageRoute(unloaded, {
    target: "后端",
    cwd: "/tmp/team/members/前端/src",
    sourceThreadId: "unavailable-runtime-thread-id",
  }), /not a CodexAgentTeam member/);
});

test("ordinary Codex conversation cannot impersonate a Team member", () => {
  assert.throws(() => resolveMessageRoute(snapshot, {
    target: "后端",
    cwd: "/tmp/unrelated",
    sourceThreadId: "ordinary-thread",
  }), /not a CodexAgentTeam member/);
});

test("a shared Team directory never guesses which member is sending", () => {
  const shared = structuredClone(snapshot);
  shared.teams[0].members[0].cwd = "/tmp/team";
  shared.teams[0].members[1].cwd = "/tmp/team";

  assert.throws(() => resolveMessageRoute(shared, {
    target: "后端",
    cwd: "/tmp/team",
  }), /native Thread identity is required/);
});

test("member communication resolves names with deterministic case folding", () => {
  assert.equal(resolveMessageRoute(snapshot, {
    target: "后端",
    cwd: "/tmp/team/frontend"
  }).targetThreadId, "thread-back");
});

test("member communication cannot target the source member", () => {
  assert.throws(() => resolveMessageRoute(snapshot, {
    target: "前端",
    cwd: "/tmp/team/frontend",
  }), /cannot message itself/);
});

test("message submission uses one path-safe lease per target member", () => {
  const first = messageLeaseFile({ runRoot: "/tmp/run" }, "backend/member");
  const second = messageLeaseFile({ runRoot: "/tmp/run" }, "backend/member");
  const other = messageLeaseFile({ runRoot: "/tmp/run" }, "frontend");

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.equal(path.dirname(first), "/tmp/run/message-locks");
  assert.match(path.basename(first), /^[a-f0-9]{64}\.lock$/);
});
