import assert from "node:assert/strict";
import test from "node:test";

import { resolveMemberRoute } from "../scripts/send-member-message.mjs";

const snapshot = {
  teams: [{
    id: "team-1",
    name: "商业化团队",
    members: [
      { id: "frontend", name: "前端", cwd: "/tmp/team/frontend", threadId: "thread-front" },
      { id: "backend", name: "后端", cwd: "/tmp/team/backend", threadId: "thread-back" },
    ],
  }],
};

test("member communication resolves source by native thread and target inside the same Team", () => {
  assert.deepEqual(resolveMemberRoute(snapshot, {
    target: "后端",
    cwd: "/unrelated",
    sourceThreadId: "thread-front",
  }), {
    teamId: "team-1",
    sourceName: "前端",
    targetMemberId: "backend",
    targetName: "后端",
  });
});

test("member communication resolves source from a path inside the member workspace", () => {
  assert.equal(resolveMemberRoute(snapshot, {
    target: "backend",
    cwd: "/tmp/team/frontend/src",
  }).sourceName, "前端");
});

test("member communication cannot target the source member", () => {
  assert.throws(() => resolveMemberRoute(snapshot, {
    target: "前端",
    cwd: "/tmp/team/frontend",
  }), /不能向自己/);
});
