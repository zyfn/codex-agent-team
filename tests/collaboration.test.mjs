import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  messageLeaseFile,
  resolveCollaborationContext,
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

test("member context returns one consistent Team context shape", () => {
  assert.deepEqual(resolveCollaborationContext(snapshot, {
    cwd: "/tmp/team/frontend/src"
  }), {
    currentMember: {
      teamId: "team-1",
      threadId: "thread-front",
      name: "前端",
      role: "负责用户界面",
      cwd: "/tmp/team/frontend"
    },
    teams: [{
      teamId: "team-1",
      name: "商业化团队",
      sharedDirectory: "/tmp/team/shared",
      members: [
        { threadId: "thread-front", name: "前端", role: "负责用户界面", cwd: "/tmp/team/frontend" },
        { threadId: "thread-back", name: "后端", role: "负责服务接口", cwd: "/tmp/team/backend" }
      ]
    }]
  });
});

test("ordinary Codex context can inspect Teams without pretending to be a member", () => {
  const context = resolveCollaborationContext(snapshot, {
    sourceThreadId: "ordinary-thread",
    cwd: "/tmp/unrelated",
  });

  assert.equal(context.currentMember, null);
  assert.deepEqual(context.teams.map(({ name }) => name), ["商业化团队"]);
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

test("ordinary Codex conversation can message a globally unique Team member", () => {
  assert.deepEqual(resolveMessageRoute(snapshot, {
    target: "后端",
    cwd: "/tmp/unrelated",
    sourceThreadId: "ordinary-thread",
  }), {
    teamId: "team-1",
    sourceName: "User",
    targetThreadId: "thread-back",
    targetName: "后端",
  });
});

test("ordinary conversation selects a Team when member names are duplicated", () => {
  const duplicated = structuredClone(snapshot);
  duplicated.teams.push({
    teamId: "team-2",
    name: "平台团队",
    sharedDirectory: "/tmp/platform/shared",
    members: [{ name: "后端", role: "平台后端", cwd: "/tmp/platform/backend", threadId: "thread-platform" }],
  });

  assert.throws(() => resolveMessageRoute(duplicated, {
    target: "后端",
    cwd: "/tmp/unrelated",
  }), /specify a Team/);
  assert.equal(resolveMessageRoute(duplicated, {
    team: "平台团队",
    target: "后端",
    cwd: "/tmp/unrelated",
  }).targetThreadId, "thread-platform");
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
