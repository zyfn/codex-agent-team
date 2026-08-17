import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  configureCodexDesktopTeamTransport,
  hasDesktopStdioAppServerSnapshot,
  isTeamDesktopProcessSnapshot,
  parseDesktopProcessTreePids,
  parseDesktopPids,
  restoreCodexDesktopStdioMode,
  waitForDesktopPidsExit
} from "../scripts/lib/desktop-lifecycle.mjs";

test("mode keeper distinguishes a Team CDP launch from an ordinary Desktop launch", () => {
  const ordinary = "100 /Applications/Codex.app/Contents/MacOS/ChatGPT";
  const team = "101 /Applications/Codex.app/Contents/MacOS/ChatGPT --remote-debugging-port=49321";

  assert.equal(isTeamDesktopProcessSnapshot(ordinary), false);
  assert.equal(isTeamDesktopProcessSnapshot(team), true);
});

test("Team activation pins future Desktop launches to the Team daemon", async () => {
  const invocations = [];
  const spawnImpl = (command, args, options) => {
    invocations.push({ command, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  };

  await configureCodexDesktopTeamTransport("ws://127.0.0.1:49152/rpc", { spawnImpl });

  assert.deepEqual(invocations.map(({ command, args }) => [command, ...args]), [
    ["launchctl", "setenv", "CODEX_APP_SERVER_USE_LOCAL_DAEMON", "1"],
    ["launchctl", "setenv", "CODEX_APP_SERVER_WS_URL", "ws://127.0.0.1:49152/rpc"]
  ]);
});

test("normal mode removes the daemon override instead of replacing Codex stdio", async () => {
  const invocations = [];
  const spawnImpl = (command, args, options) => {
    invocations.push({ command, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  };

  await restoreCodexDesktopStdioMode({ spawnImpl });

  assert.deepEqual(invocations.map(({ command, args }) => [command, ...args]), [
    ["launchctl", "unsetenv", "CODEX_APP_SERVER_WS_URL"],
    ["launchctl", "unsetenv", "CODEX_APP_SERVER_USE_LOCAL_DAEMON"]
  ]);
});

test("Team startup rejects a Desktop that silently falls back to stdio", () => {
  const snapshot = [
    "  100     1 /Applications/Codex.app/Contents/MacOS/ChatGPT --remote-debugging-port=49321",
    "  101   100 /Applications/Codex.app/Contents/Resources/codex -c features.code_mode_host=true app-server --analytics-default-enabled",
    "  200     1 /Users/zyf/.codex/packages/standalone/current/codex app-server --listen unix://"
  ].join("\n");

  assert.equal(hasDesktopStdioAppServerSnapshot(snapshot, 100), true);
  assert.equal(hasDesktopStdioAppServerSnapshot(snapshot, 200), false);
});

test("desktop PID parsing ignores pgrep trailing whitespace instead of inventing PID 0", () => {
  assert.deepEqual(parseDesktopPids("65753\n"), [65753]);
  assert.deepEqual(parseDesktopPids("\n"), []);
});

test("desktop restart drains the original Desktop process tree including its stdio App Server", () => {
  const snapshot = [
    "  100     1 /Applications/Codex.app/Contents/MacOS/ChatGPT",
    "  101   100 /Applications/Codex.app/Contents/Frameworks/Codex Framework.framework/Helpers/Codex (Renderer)",
    "  102   100 /Applications/Codex.app/Contents/Resources/codex app-server --analytics-default-enabled",
    "  103   102 /Applications/Codex.app/Contents/Resources/cua_node/bin/node_repl",
    "  200     1 /Applications/Other.app/Contents/MacOS/Other",
    "  201   200 /Applications/Codex.app/Contents/Resources/codex app-server"
  ].join("\n");

  assert.deepEqual(parseDesktopProcessTreePids(snapshot), [100, 101, 102, 103]);
});

test("desktop restart waits only for the Codex processes that existed before quit", async () => {
  const probes = [];
  const alive = new Map([[101, true], [202, true]]);
  setTimeout(() => alive.set(101, false), 8);

  await waitForDesktopPidsExit([101], 100, async (pid) => {
    probes.push(pid);
    return alive.get(pid) ?? false;
  }, 2);

  assert.ok(probes.every((pid) => pid === 101));
  assert.equal(alive.get(202), true, "a newly restored Codex process must not block activation");
});
