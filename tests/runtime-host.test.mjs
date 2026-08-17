import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeHost } from "../scripts/lib/runtime-host.mjs";

test("a CDP createTeam action changes the Team service and refreshes the projection", async () => {
  const events = [];
  const expressions = [];
  const cdp = {
    async request() { return {}; },
    onEvent(listener) { events.push(listener); return () => {}; },
    async evaluate(expression) { expressions.push(expression); }
  };
  const calls = [];
  const service = {
    async snapshot() { return { revision: calls.length, teams: [] }; },
    async createTeam(input) { calls.push(input); }
  };
  const host = new RuntimeHost({ service, cdp });
  await host.attach();

  events[0]("Runtime.bindingCalled", {
    name: "codexAgentTeamBridge",
    payload: JSON.stringify({ type: "createTeam", name: "商业化团队" })
  });
  await host.whenIdle();

  assert.deepEqual(calls, [{ name: "商业化团队" }]);
  assert.ok(expressions.length >= 2);
});

test("a CDP createMember action does not require or invent an opening message", async () => {
  const events = [];
  const cdp = {
    async request() { return {}; },
    onEvent(listener) { events.push(listener); return () => {}; },
    async evaluate() {}
  };
  const calls = [];
  const service = {
    async snapshot() { return { revision: calls.length, teams: [] }; },
    async createMember(input) { calls.push(input); }
  };
  const host = new RuntimeHost({ service, cdp });
  await host.attach();

  events[0]("Runtime.bindingCalled", {
    name: "codexAgentTeamBridge",
    payload: JSON.stringify({
      type: "createMember",
      teamId: "team-1",
      name: "后端",
      role: "负责服务端"
    })
  });
  await host.whenIdle();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "后端");
  assert.equal("openingMessage" in calls[0], false);
});

test("a fresh renderer execution context restores the Team projection", async () => {
  const events = [];
  const requests = [];
  let snapshots = 0;
  const cdp = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "team-bootstrap" };
      return {};
    },
    onEvent(listener) { events.push(listener); return () => {}; },
    async evaluate() {}
  };
  const service = {
    async snapshot() { snapshots += 1; return { revision: snapshots, teams: [] }; }
  };
  const host = new RuntimeHost({ service, cdp });
  await host.attach();

  events[0]("Runtime.executionContextCreated", {
    context: { auxData: { isDefault: true } }
  });
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.ok(snapshots >= 2);
  assert.ok(requests.some(({ method }) => method === "Page.addScriptToEvaluateOnNewDocument"));
});

test("dashboard management actions route to explicit Team service methods", async () => {
  const events = [];
  const calls = [];
  const cdp = {
    async request() { return {}; },
    onEvent(listener) { events.push(listener); return () => {}; },
    async evaluate() {}
  };
  const service = {
    async snapshot() { return { teams: [] }; },
    async updateTeam(teamId, input) { calls.push(["updateTeam", teamId, input]); },
    async deleteMember(teamId, memberId) { calls.push(["deleteMember", teamId, memberId]); },
    async deleteTeam(teamId) { calls.push(["deleteTeam", teamId]); }
  };
  const host = new RuntimeHost({ service, cdp });
  await host.attach();

  for (const action of [
    { type: "updateTeam", teamId: "team-1", name: "增长团队" },
    { type: "deleteMember", teamId: "team-1", memberId: "member-1" },
    { type: "deleteTeam", teamId: "team-1" }
  ]) {
    events[0]("Runtime.bindingCalled", {
      name: "codexAgentTeamBridge",
      payload: JSON.stringify(action)
    });
  }
  await host.whenIdle();

  assert.deepEqual(calls, [
    ["updateTeam", "team-1", { name: "增长团队" }],
    ["deleteMember", "team-1", "member-1"],
    ["deleteTeam", "team-1"]
  ]);
});

test("member activation routes through Codex native navigation without resuming the thread", async () => {
  const events = [];
  const calls = [];
  const cdp = {
    async request() { return {}; },
    onEvent(listener) { events.push(listener); return () => {}; },
    async evaluate() {}
  };
  const service = {
    async snapshot() { return { teams: [] }; },
    async navigateMember(teamId, memberId) { calls.push([teamId, memberId]); }
  };
  const host = new RuntimeHost({ service, cdp });
  await host.attach();

  events[0]("Runtime.bindingCalled", {
    name: "codexAgentTeamBridge",
    payload: JSON.stringify({
      type: "navigateMember",
      teamId: "team-1",
      memberId: "member-1"
    })
  });
  await host.whenIdle();

  assert.deepEqual(calls, [["team-1", "member-1"]]);
});
