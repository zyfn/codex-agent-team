import assert from "node:assert/strict";
import test from "node:test";

import {
  createDesktopTeams,
  probeDesktopTeams,
  removeDesktopTeam,
  upsertDesktopTeam
} from "../plugins/codex-agent-team/scripts/lib/runtime/desktop/teams.mjs";

test("serialized Desktop Team actions are self-contained in the renderer", async () => {
  const expressions = [];
  const adapter = createDesktopTeams({
    cdp: { async evaluate(expression) { expressions.push(expression); return {}; } }
  });

  await adapter.assign({ threadId: "thread-1", teamId: "team-1" });
  await adapter.unassign("thread-1");

  assert.equal(expressions.length, 2);
  assert.ok(expressions.every((expression) => expression.includes("localThreadCatalog.requestSync")));
  assert.ok(expressions.every((expression) => !expression.includes("refreshLocalThreadCatalog")));
});

test("Desktop Teams use the native local-project registry", async () => {
  const calls = [];
  const appServices = {
    projects: {
      async upsertLocal(value) { calls.push(["upsert", value]); },
      async removeLocal(projectId) { calls.push(["remove", projectId]); }
    },
    threadProjectAssignments: {
      async setAssignment() {}
    },
    localThreadCatalog: {
      async requestSync() {}
    }
  };
  const load = async () => appServices;

  assert.deepEqual(await probeDesktopTeams(load), { compatible: true, missing: [] });
  await upsertDesktopTeam({
    teamId: "team-1",
    name: "Commercialization",
    teamDirectory: "/tmp/team-root"
  }, load);
  await removeDesktopTeam("team-1", load);

  assert.deepEqual(calls, [
    ["upsert", {
      projectId: "team-1",
      name: "Commercialization",
      sources: ["/tmp/team-root"]
    }],
    ["remove", "team-1"]
  ]);
});

test("Desktop Team compatibility fails closed when native project operations disappear", async () => {
  assert.deepEqual(await probeDesktopTeams(async () => ({ projects: {} })), {
    compatible: false,
    missing: [
      "projects.upsertLocal",
      "projects.removeLocal",
      "threadProjectAssignments.setAssignment",
      "localThreadCatalog.requestSync"
    ]
  });
});

test("Desktop Teams assign a native Thread and refresh the local catalog", async () => {
  const module = await import("../plugins/codex-agent-team/scripts/lib/runtime/desktop/teams.mjs");
  assert.equal(typeof module.assignDesktopMember, "function");
  const calls = [];
  const load = async () => ({
    threadProjectAssignments: {
      async setAssignment(value) { calls.push(["assign", value]); }
    },
    localThreadCatalog: {
      async requestSync(scope, priority) { calls.push(["sync", scope, priority]); }
    }
  });

  await module.assignDesktopMember({
    threadId: "thread-frontend",
    teamId: "team-1"
  }, load);

  assert.deepEqual(calls, [
    ["assign", {
      threadId: "thread-frontend",
      assignment: { projectKind: "local", projectId: "team-1" }
    }],
    ["sync", ["local"], "immediate"]
  ]);
});
