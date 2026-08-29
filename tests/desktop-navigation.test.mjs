import assert from "node:assert/strict";
import test from "node:test";

import {
  createDesktopNavigation,
  waitForAppServices
} from "../plugins/codex-agent-team/scripts/lib/runtime/desktop/navigation.mjs";

test("Desktop navigation compatibility fails closed when the native action is unavailable", async () => {
  const adapter = createDesktopNavigation({
    cdp: {
      async evaluate() {
        return { compatible: false, missing: ["appActions.runInPrimaryWindow"] };
      }
    }
  });

  await assert.rejects(
    adapter.assertCompatible(),
    (error) => error.code === "CODEX_DESKTOP_UNSUPPORTED" &&
      /appActions/.test(error.message)
  );
});

test("waits for Codex live appServices export instead of freezing its initial undefined value", async () => {
  let services;
  const rpcModule = {};
  Object.defineProperty(rpcModule, "appServices", {
    enumerable: true,
    get() { return services; }
  });
  setTimeout(() => { services = { appActions: { runInPrimaryWindow() {} } }; }, 10);

  const resolved = await waitForAppServices(async () => rpcModule, {
    timeoutMs: 200,
    pollMs: 2
  });

  assert.equal(resolved, services);
});

test("opening a member uses Codex native primary-window navigation", async () => {
  let expression = "";
  const adapter = createDesktopNavigation({
    cdp: {
      async evaluate(source) {
        expression = source;
        return { navigated: true };
      }
    }
  });

  await adapter.openThread("thread-member");

  assert.match(expression, /appActions\.runInPrimaryWindow/);
  assert.match(expression, /windows\.show_thread/);
  assert.match(expression, /thread-member/);
  assert.match(expression, /windowId:\s*["']current["']/);
  assert.doesNotMatch(expression, /localProjects|threadProjectAssignments/);
});
