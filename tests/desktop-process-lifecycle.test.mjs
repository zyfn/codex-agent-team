import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  isUnexpectedDesktopDisconnect,
  parseDesktopStdioAppServerPids,
  requestCodexDesktopQuit,
  stopTeamDesktopHelpers,
  waitForChildProcessExit
} from "../plugins/codex-agent-team/scripts/lib/runtime/desktop/process.mjs";

test("a CDP disconnect immediately followed by Desktop exit is a normal close", async () => {
  assert.equal(await isUnexpectedDesktopDisconnect({
    desktopExited: Promise.resolve({ code: 0, signal: null }),
    wait: async () => new Promise(() => {})
  }), false);
});

test("a CDP disconnect while Desktop remains open is an integration failure", async () => {
  assert.equal(await isUnexpectedDesktopDisconnect({
    desktopExited: new Promise(() => {}),
    wait: async () => {}
  }), true);
});

test("Desktop exit clears the CDP disconnect grace timer", async () => {
  let resolveDesktopExit;
  const desktopExited = new Promise((resolve) => { resolveDesktopExit = resolve; });
  let clearedTimer = null;
  const result = isUnexpectedDesktopDisconnect({
    desktopExited,
    setTimeoutImpl() { return 991; },
    clearTimeoutImpl(timer) { clearedTimer = timer; }
  });

  resolveDesktopExit({ code: 0, signal: null });

  assert.equal(await result, false);
  assert.equal(clearedTimer, 991);
});

test("Runtime stops only crashpad helpers owned by the Team Desktop profile", async () => {
  const profileRoot = "/tmp/agent-team-profile";
  const alive = new Set([41, 42]);
  const signals = [];
  const stopped = await stopTeamDesktopHelpers({
    profileRoot,
    readProcesses: async () => [
      `41 1 /Applications/Codex.app/browser_crashpad_handler --database=${profileRoot}/Crashpad`,
      `42 1 /Applications/Codex.app/browser_crashpad_handler --database=${profileRoot}/Crashpad --no-periodic-tasks`,
      "43 1 /Applications/Codex.app/browser_crashpad_handler --database=/tmp/ordinary-profile/Crashpad"
    ].join("\n"),
    isProcessAlive: (pid) => alive.has(pid),
    signalProcess(pid, signal) {
      signals.push([pid, signal]);
      alive.delete(pid);
    },
    wait: async () => {}
  });

  assert.deepEqual(stopped, [41, 42]);
  assert.deepEqual(signals, [[41, "SIGTERM"], [42, "SIGTERM"]]);
});

test("native quit targets exactly the Desktop owned by the current CodexAgentTeam run", async () => {
  const invocations = [];
  const spawnImpl = (command, args) => {
    invocations.push([command, ...args]);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  };

  await requestCodexDesktopQuit({ pid: 100, spawnImpl });

  assert.equal(invocations.length, 1);
  assert.equal(invocations[0][0], "osascript");
  assert.match(invocations[0].at(-1), /runningApplicationWithProcessIdentifier\(100\)/);
  assert.doesNotMatch(invocations[0].at(-1), /application id/);
});

test("waiting for the owned Team Desktop clears its timeout after the child exits", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  let timeoutCallback;
  let clearedTimer = null;
  const waiting = waitForChildProcessExit(child, {
    timeoutMs: 5 * 60_000,
    setTimeoutImpl(callback) {
      timeoutCallback = callback;
      return 731;
    },
    clearTimeoutImpl(timer) {
      clearedTimer = timer;
    }
  });

  child.exitCode = 0;
  child.emit("exit", 0, null);

  assert.deepEqual(await waiting, { code: 0, signal: null });
  assert.equal(clearedTimer, 731);
  assert.equal(typeof timeoutCallback, "function");
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("Team Desktop verification detects only its own unexpected stdio App Server", () => {
  const snapshot = [
    "  100     1 /Applications/Codex.app/Contents/MacOS/ChatGPT --remote-debugging-port=9339",
    "  101   100 /Applications/Codex.app/Contents/Resources/codex app-server --stdio",
    "  102   100 /Applications/Codex.app/Contents/Resources/codex app-server proxy",
    "  200     1 /Applications/Codex.app/Contents/Resources/codex app-server --listen ws://127.0.0.1:9338"
  ].join("\n");

  assert.deepEqual(parseDesktopStdioAppServerPids(snapshot, { desktopPid: 100 }), [101]);
});
