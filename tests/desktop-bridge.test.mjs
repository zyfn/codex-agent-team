import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopBridge } from "../plugins/codex-agent-team/scripts/lib/runtime/desktop/bridge.mjs";

test("a CDP createTeam action changes CodexAgentTeam Manager and refreshes the projection", async () => {
  const events = [];
  const expressions = [];
  const cdp = {
    async request() { return {}; },
    onEvent(listener) { events.push(listener); return () => {}; },
    async evaluate(expression) { expressions.push(expression); }
  };
  const calls = [];
  const manager = {
    async snapshot() { return { teams: [] }; },
    async restoreDesktopProjection() {},
    async execute(input) { calls.push(input); }
  };
  const host = createDesktopBridge({ manager, cdp });
  await host.attach();

  events[0]("Runtime.bindingCalled", {
    name: "codexAgentTeamBridge",
    payload: JSON.stringify({ type: "createTeam", name: "商业化团队" })
  });
  await host.whenIdle();

  assert.deepEqual(calls, [{ type: "createTeam", name: "商业化团队" }]);
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
  const manager = {
    async snapshot() { return { teams: [] }; },
    async restoreDesktopProjection() {},
    async execute(input) { calls.push(input); }
  };
  const host = createDesktopBridge({ manager, cdp });
  await host.attach();

  events[0]("Runtime.bindingCalled", {
    name: "codexAgentTeamBridge",
    payload: JSON.stringify({
      type: "createMember",
      teamId: "team-1",
      name: "后端",
      role: "负责服务端",
      localGitDirectory: "/tmp/backend"
    })
  });
  await host.whenIdle();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "后端");
  assert.equal(calls[0].localGitDirectory, "/tmp/backend");
  assert.equal("openingMessage" in calls[0], false);
});

test("working-directory inspection returns Git capability to the member form", async () => {
  const events = [];
  const expressions = [];
  const cdp = {
    async request() { return {}; },
    onEvent(listener) { events.push(listener); return () => {}; },
    async evaluate(expression) { expressions.push(expression); }
  };
  const manager = {
    async snapshot() { return { teams: [] }; },
    async restoreDesktopProjection() {},
    async execute(command) { return { path: command.path, isGit: true }; }
  };
  const host = createDesktopBridge({ manager, cdp });
  await host.attach();

  events[0]("Runtime.bindingCalled", {
    name: "codexAgentTeamBridge",
    payload: JSON.stringify({
      type: "inspectWorkingDirectory",
      requestId: "inspect-1",
      path: "/tmp/repository"
    })
  });
  await host.whenIdle();

  assert.ok(expressions.some((expression) =>
    expression.includes("receiveWorkspaceInspection") &&
    expression.includes('"requestId":"inspect-1"') &&
    expression.includes('"isGit":true')
  ));
});

test("a stalled createMember action releases the Dashboard instead of hanging forever", async () => {
  const events = [];
  const expressions = [];
  const cdp = {
    async request() { return {}; },
    onEvent(listener) { events.push(listener); return () => {}; },
    async evaluate(expression) { expressions.push(expression); }
  };
  const manager = {
    async snapshot() { return { teams: [] }; },
    async restoreDesktopProjection() {},
    async execute() { return new Promise(() => {}); }
  };
  const host = createDesktopBridge({
    manager,
    cdp,
    actionTimeoutMs: 10
  });
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

  const outcome = await Promise.race([
    host.whenIdle().then(() => "settled"),
    new Promise((resolve) => setTimeout(() => resolve("stalled"), 100))
  ]);

  assert.equal(outcome, "settled");
  assert.ok(expressions.some((expression) => /timed out/i.test(expression)));
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
  const manager = {
    async snapshot() { snapshots += 1; return { teams: [] }; }
  };
  const host = createDesktopBridge({ manager, cdp });
  await host.attach();

  events[0]("Runtime.executionContextCreated", {
    context: { auxData: { isDefault: true } }
  });
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.ok(snapshots >= 2);
  assert.ok(requests.some(({ method }) => method === "Page.addScriptToEvaluateOnNewDocument"));
});

test("a temporarily late CDP endpoint does not fail Team-mode startup", async () => {
  let attempts = 0;
  const cdp = {
    async request(method) {
      if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "team-bootstrap" };
      return {};
    },
    onEvent() { return () => {}; },
    async evaluate() {}
  };
  const host = createDesktopBridge({
    manager: { async snapshot() { return { teams: [] }; } },
    connectCdp: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("ECONNREFUSED");
      return cdp;
    },
    cdpConnectTimeoutMs: 100,
    cdpPollMs: 0,
    delayImpl: async () => {}
  });

  await host.attach();

  assert.equal(attempts, 3);
});

test("temporarily late renderer resources do not fail Team-mode startup", async () => {
  let attempts = 0;
  const cdp = {
    async request(method) {
      if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "team-bootstrap" };
      return {};
    },
    onEvent() { return () => {}; },
    async evaluate() {}
  };
  const manager = { async snapshot() { return { teams: [] }; } };
  const navigation = {
    async assertCompatible() {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("This Codex Desktop build is not supported: renderer entry");
        error.code = "CODEX_DESKTOP_UNSUPPORTED";
        throw error;
      }
      return { compatible: true, missing: [] };
    }
  };
  const host = createDesktopBridge({
    manager,
    navigation,
    cdp,
    rendererReadyTimeoutMs: 100,
    rendererPollMs: 0,
    delayImpl: async () => {}
  });

  await host.attach();

  assert.equal(attempts, 3);
});

test("transport verification happens before Desktop Team restoration", async () => {
  let reconciled = false;
  const cdp = {
    async request() { return {}; },
    onEvent() { return () => {}; },
    async evaluate() {},
    close() {}
  };
  const host = createDesktopBridge({
    cdp,
    manager: {
      async restoreDesktopProjection() { reconciled = true; },
      async snapshot() { return { teams: [] }; }
    },
    verifyTransport: async () => { throw new Error("unexpected stdio App Server"); }
  });

  await assert.rejects(host.attach(), /unexpected stdio App Server/);
  assert.equal(reconciled, false);
});

test("native sidebar compatibility is proven before Desktop Team restoration", async () => {
  const order = [];
  const cdp = {
    async request(method) {
      if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "team-bootstrap" };
      return {};
    },
    onEvent() { return () => {}; },
    async evaluate(expression) {
      if (expression.includes("installTeamUi")) order.push("sidebar");
      return { installed: true };
    }
  };
  const host = createDesktopBridge({
    cdp,
    manager: {
      async snapshot() { return { teams: [] }; },
      async restoreDesktopProjection() { order.push("teams"); }
    }
  });

  await host.attach();

  assert.ok(order.indexOf("sidebar") >= 0);
  assert.ok(order.indexOf("teams") > order.indexOf("sidebar"));
});

test("a temporarily late native sidebar does not fail the whole Team-mode startup", async () => {
  let polls = 0;
  const cdp = {
    async request(method) {
      if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "team-bootstrap" };
      return {};
    },
    onEvent() { return () => {}; },
    async evaluate(expression) {
      if (expression.startsWith("Boolean(document.querySelector")) {
        polls += 1;
        return polls >= 2;
      }
      return { installed: false };
    }
  };
  const host = createDesktopBridge({
    manager: { async snapshot() { return { teams: [] }; } },
    cdp,
    sidebarReadyTimeoutMs: 100,
    sidebarPollMs: 0,
    delayImpl: async () => {}
  });

  await host.attach();

  assert.equal(polls, 2);
});

test("a permanently missing native sidebar still fails closed", async () => {
  const cdp = {
    async request(method) {
      if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "team-bootstrap" };
      return {};
    },
    onEvent() { return () => {}; },
    async evaluate() { return { installed: false }; }
  };
  const host = createDesktopBridge({
    manager: { async snapshot() { return { teams: [] }; } },
    cdp,
    sidebarReadyTimeoutMs: 0
  });

  await assert.rejects(host.attach(), (error) =>
    error.code === "CODEX_DESKTOP_UNSUPPORTED"
      && /sidebar anchor/.test(error.message)
  );
});

test("a live CDP disconnect invalidates the adapter and reports one fail-closed signal", async () => {
  let disconnectListener;
  const reported = [];
  const cdp = {
    async request(method) {
      if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "team-bootstrap" };
      return {};
    },
    onEvent() { return () => {}; },
    onDisconnect(listener) { disconnectListener = listener; return () => { disconnectListener = null; }; },
    async evaluate() {}
  };
  const host = createDesktopBridge({
    manager: { async snapshot() { return { teams: [] }; } },
    cdp,
    onDisconnect: (error) => reported.push(error)
  });
  await host.attach();

  const error = new Error("CDP target closed");
  disconnectListener(error);

  assert.equal(host.connected, false);
  assert.deepEqual(reported, [error]);
});

test("dashboard refresh bootstraps once and only pushes new snapshot data", async () => {
  const requests = [];
  const expressions = [];
  const cdp = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "team-bootstrap" };
      return {};
    },
    onEvent() { return () => {}; },
    async evaluate(expression) { expressions.push(expression); }
  };
  const host = createDesktopBridge({
    manager: { async snapshot() { return { teams: [] }; } },
    cdp,
    builtInAvatars: [{ id: "duck", dataUrl: "data:image/jpeg;base64,avatar" }]
  });

  await host.attach();
  await host.refresh();
  await host.refresh();

  assert.equal(requests.filter(({ method }) => method === "Page.addScriptToEvaluateOnNewDocument").length, 1);
  assert.equal(requests.filter(({ method }) => method === "Page.removeScriptToEvaluateOnNewDocument").length, 0);
  assert.ok(expressions.slice(1).every((expression) => !expression.includes("data:image/jpeg;base64,avatar")));
});

test("dashboard management actions route through the Manager command interface", async () => {
  const events = [];
  const calls = [];
  const cdp = {
    async request() { return {}; },
    onEvent(listener) { events.push(listener); return () => {}; },
    async evaluate() {}
  };
  const manager = {
    async snapshot() { return { teams: [] }; },
    async execute(action) { calls.push(action); }
  };
  const host = createDesktopBridge({ manager, cdp });
  await host.attach();

  for (const action of [
    { type: "renameTeam", teamId: "team-1", name: "增长团队" },
    { type: "removeMember", teamId: "team-1", threadId: "member-1" },
    { type: "removeTeam", teamId: "team-1" }
  ]) {
    events[0]("Runtime.bindingCalled", {
      name: "codexAgentTeamBridge",
      payload: JSON.stringify(action)
    });
  }
  await host.whenIdle();

  assert.deepEqual(calls, [
    { type: "renameTeam", teamId: "team-1", name: "增长团队" },
    { type: "removeMember", teamId: "team-1", threadId: "member-1" },
    { type: "removeTeam", teamId: "team-1" }
  ]);
});

test("Dashboard terminal actions route through the selected native terminal implementation", async () => {
  const events = [];
  const calls = [];
  const expressions = [];
  const cdp = {
    async request() { return {}; },
    onEvent(listener) { events.push(listener); return () => {}; },
    async evaluate(expression) { expressions.push(expression); }
  };
  const manager = { async snapshot() { return { teams: [] }; } };
  const terminalLauncher = {
    async applications() {
      return {
        ghostty: { available: true, icon: "data:image/png;base64,ghostty" },
        cmux: { available: false, icon: null }
      };
    },
    async open(input) { calls.push(input); }
  };
  const host = createDesktopBridge({ manager, terminalLauncher, cdp });
  await host.attach();

  for (const terminal of ["ghostty", "cmux"]) {
    events[0]("Runtime.bindingCalled", {
      name: "codexAgentTeamBridge",
      payload: JSON.stringify({ type: "openTeamTerminal", teamId: "team-1", terminal })
    });
  }
  await host.whenIdle();

  assert.deepEqual(calls, [
    { teamId: "team-1", terminal: "ghostty" },
    { teamId: "team-1", terminal: "cmux" }
  ]);
  assert.match(expressions.join("\n"), /"terminalApplications":\{"ghostty":\{"available":true,"icon":"data:image\/png;base64,ghostty"\},"cmux":\{"available":false,"icon":null\}\}/);
});

test("member activation routes through Codex native navigation without resuming the thread", async () => {
  const events = [];
  const calls = [];
  const expressions = [];
  const cdp = {
    async request() { return {}; },
    onEvent(listener) { events.push(listener); return () => {}; },
    async evaluate(expression) { expressions.push(expression); }
  };
  const manager = {
    async snapshot() { return { teams: [] }; },
    async execute(action) { calls.push([action.teamId, action.threadId]); }
  };
  const host = createDesktopBridge({ manager, cdp });
  await host.attach();

  events[0]("Runtime.bindingCalled", {
    name: "codexAgentTeamBridge",
    payload: JSON.stringify({
      type: "openMember",
      teamId: "team-1",
      threadId: "member-1"
    })
  });
  await host.whenIdle();

  assert.deepEqual(calls, [["team-1", "member-1"]]);
  assert.equal(expressions.at(-1), "window.__codexAgentTeam?.closePanel?.()");
});
