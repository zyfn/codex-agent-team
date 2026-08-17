import assert from "node:assert/strict";
import test from "node:test";

import { ensureDefaultDaemon, stopDefaultDaemon } from "../scripts/lib/daemon.mjs";

test("daemon startup never inherits a versioned plugin cache working directory", async () => {
  const calls = [];

  const result = await ensureDefaultDaemon("/Applications/Codex.app/Contents/Resources/codex", {
    codexHome: "/Users/example/.codex",
    execFileImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        stdout: JSON.stringify({
          socketPath: "/Users/example/.codex/app-server-control/app-server-control.sock",
          appServerVersion: "0.147.0"
        })
      };
    }
  });

  assert.equal(result.appServerVersion, "0.147.0");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cwd, "/Users/example/.codex");
});

test("daemon startup replaces a running daemon whose plugin cache cwd was deleted", async () => {
  const calls = [];
  let starts = 0;
  const codexCli = "/Applications/Codex.app/Contents/Resources/codex";
  const socketPath = "/Users/example/.codex/app-server-control/app-server-control.sock";

  await ensureDefaultDaemon(codexCli, {
    codexHome: "/Users/example/.codex",
    socketPath,
    pathExistsImpl: async (target) => target !== "/Users/example/.codex/plugins/cache/old-version",
    execFileImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === codexCli && args.at(-1) === "start") {
        starts += 1;
        return { stdout: JSON.stringify({ socketPath, appServerVersion: "0.147.0" }) };
      }
      if (command === codexCli && args.at(-1) === "stop") return { stdout: "" };
      if (command === "lsof" && args.includes("cwd")) {
        return { stdout: "p81516\nfcwd\nn/Users/example/.codex/plugins/cache/old-version\n" };
      }
      if (command === "lsof") return { stdout: "81516\n" };
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    }
  });

  assert.equal(starts, 2);
  const codexCalls = calls.filter(({ command }) => command === codexCli);
  assert.deepEqual(codexCalls.map(({ args }) => args.at(-1)), ["start", "stop", "start"]);
  assert.ok(codexCalls.every(({ options }) => options.cwd === "/Users/example/.codex"));
});

test("an unmanaged daemon is stopped only through its validated Unix socket owner", async () => {
  const calls = [];
  const execFileImpl = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "/Applications/Codex.app/Contents/Resources/codex") {
      throw new Error("app server is running but is not managed by codex app-server daemon");
    }
    if (command === "lsof") return { stdout: "73026\n" };
    if (command === "ps") {
      return { stdout: "/Users/example/.codex/packages/standalone/current/codex app-server --listen unix://\n" };
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  const signals = [];

  await stopDefaultDaemon("/Applications/Codex.app/Contents/Resources/codex", {
    socketPath: "/Users/example/.codex/app-server-control/app-server-control.sock",
    execFileImpl,
    killImpl: (pid, signal) => signals.push([pid, signal]),
    waitForExitImpl: async (pid) => calls.push(["wait", String(pid)])
  });

  assert.deepEqual(signals, [[73026, "SIGTERM"]]);
  assert.deepEqual(calls, [
    ["/Applications/Codex.app/Contents/Resources/codex", "app-server", "daemon", "stop"],
    ["lsof", "-nP", "-t", "--", "/Users/example/.codex/app-server-control/app-server-control.sock"],
    ["ps", "-p", "73026", "-o", "command="],
    ["wait", "73026"]
  ]);
});

test("unmanaged-daemon cleanup refuses to terminate a Desktop stdio App Server", async () => {
  const signals = [];
  const execFileImpl = async (command) => {
    if (command === "/Applications/Codex.app/Contents/Resources/codex") {
      throw new Error("app server is running but is not managed by codex app-server daemon");
    }
    if (command === "lsof") return { stdout: "24785\n" };
    if (command === "ps") {
      return { stdout: "/Applications/Codex.app/Contents/Resources/codex -c features.code_mode_host=true app-server --analytics-default-enabled\n" };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await assert.rejects(
    stopDefaultDaemon("/Applications/Codex.app/Contents/Resources/codex", {
      socketPath: "/Users/example/.codex/app-server-control/app-server-control.sock",
      execFileImpl,
      killImpl: (pid, signal) => signals.push([pid, signal])
    }),
    /Refusing to stop unmanaged daemon PID 24785/
  );

  assert.deepEqual(signals, []);
});

test("stopping an already absent daemon is idempotent", async () => {
  await stopDefaultDaemon("/Applications/Codex.app/Contents/Resources/codex", {
    socketPath: "/Users/example/.codex/app-server-control/app-server-control.sock",
    execFileImpl: async () => {
      throw new Error("failed to connect: No such file or directory (os error 2)");
    },
    socketExistsImpl: async () => false
  });
});
