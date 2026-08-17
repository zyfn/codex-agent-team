import assert from "node:assert/strict";
import test from "node:test";

import {
  DesktopProjectAdapter,
  waitForAppServices
} from "../scripts/lib/desktop-project-adapter.mjs";

test("waits for Codex live appServices export instead of freezing its initial undefined value", async () => {
  let services;
  const rpcModule = {};
  Object.defineProperty(rpcModule, "appServices", {
    enumerable: true,
    get() { return services; }
  });

  setTimeout(() => {
    services = { localProjects: { upsert() {} } };
  }, 10);

  const resolved = await waitForAppServices(async () => rpcModule, {
    timeoutMs: 200,
    pollMs: 2
  });

  assert.equal(resolved, services);
});

test("sync creates the same-name native Project and assigns every member Thread to it", async () => {
  let expression = "";
  const adapter = new DesktopProjectAdapter({
    cdp: {
      async evaluate(source) {
        expression = source;
        return { projectsUpserted: 1, assignmentsSet: 2 };
      }
    }
  });

  const result = await adapter.sync([{
    id: "team-commercial",
    projectId: "team-commercial",
    name: "商业化团队",
    cwd: "/tmp/codex-agent-team/team-commercial",
    members: [
      { threadId: "thread-frontend", cwd: "/tmp/codex-agent-team/team-commercial/前端" },
      { threadId: "thread-backend", cwd: "/tmp/codex-agent-team/team-commercial/后端" }
    ]
  }]);

  assert.deepEqual(result, { projectsUpserted: 1, assignmentsSet: 2 });
  assert.match(expression, /localProjects\.upsert/);
  assert.match(expression, /threadProjectAssignments\.setAssignment/);
  assert.match(expression, /localThreadCatalog\.requestSync/);
  assert.match(expression, /commercial/);
  assert.match(expression, /商业化团队/);
  assert.match(expression, /thread-frontend/);
  assert.match(expression, /thread-backend/);
  assert.match(expression, /projectKind:\s*["']local["']/);
  assert.match(expression, /rpc-/);
});

test("opening an empty member uses Codex native window navigation", async () => {
  let expression = "";
  const adapter = new DesktopProjectAdapter({
    cdp: {
      async evaluate(source) {
        expression = source;
        return { navigated: true };
      }
    }
  });

  await adapter.openThread("thread-empty");

  assert.match(expression, /appActions\.runInPrimaryWindow/);
  assert.match(expression, /windows\.show_thread/);
  assert.match(expression, /thread-empty/);
  assert.match(expression, /windowId:\s*["']current["']/);
});

test("removing a member clears only its native Project assignment", async () => {
  let expression = "";
  const adapter = new DesktopProjectAdapter({
    cdp: { async evaluate(source) { expression = source; return { detached: true }; } }
  });

  await adapter.removeMember("thread-backend");

  assert.match(expression, /threadProjectAssignments\.setAssignment/);
  assert.match(expression, /assignment:\s*null/);
  assert.match(expression, /thread-backend/);
  assert.doesNotMatch(expression, /thread\/delete|thread\/archive/);
});

test("removing a Team clears member assignments and removes the native Project only", async () => {
  let expression = "";
  const adapter = new DesktopProjectAdapter({
    cdp: { async evaluate(source) { expression = source; return { removed: true }; } }
  });

  await adapter.removeTeam({
    projectId: "project-commercial",
    members: [{ threadId: "thread-backend" }, { threadId: "thread-frontend" }]
  });

  assert.match(expression, /localProjects\.remove/);
  assert.match(expression, /assignment:\s*null/);
  assert.match(expression, /project-commercial/);
  assert.match(expression, /thread-backend/);
  assert.match(expression, /thread-frontend/);
  assert.doesNotMatch(expression, /thread\/delete|thread\/archive/);
});
