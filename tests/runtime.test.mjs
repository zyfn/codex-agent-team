import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prepareRuntimeBundle,
  createRuntimeController,
  spawnRuntimeProcess
} from "../plugins/codex-agent-team/scripts/lib/runtime/controller.mjs";
import { runRuntimeSession } from "../plugins/codex-agent-team/scripts/lib/runtime/session.mjs";

test("launch prepares and starts an independent CodexAgentTeam Runtime without confirmation", async () => {
  const paths = sessionPaths(await temporaryRoot("prepare"));
  const events = [];
  const controller = createRuntimeController({
    paths,
    preflight: async () => events.push("preflight"),
    startRuntime: () => { events.push("start-runtime"); return { pid: process.pid }; },
    waitForStart: async () => events.push("runtime-ready"),
    acquireLease: leaseStub()
  });

  assert.deepEqual(await controller.launch(), { status: "launched", pid: process.pid });
  assert.deepEqual(events, ["preflight", "start-runtime", "runtime-ready"]);
});

test("launch starts one detached Runtime without inspecting or closing ordinary Codex", async () => {
  const root = await temporaryRoot("open");
  const paths = sessionPaths(root);
  const calls = [];
  const controller = createRuntimeController({
    paths,
    nodeExecutable: "/opt/node",
    desktopExecutable: "/Applications/Codex.app/Contents/MacOS/ChatGPT",
    preflight: async () => calls.push("preflight"),
    startRuntime: (options) => {
      calls.push(options);
      return { pid: 8123 };
    },
    waitForStart: async (options) => calls.push(options),
    acquireLease: leaseStub()
  });

  assert.deepEqual(await controller.launch(), { status: "launched", pid: 8123 });
  assert.equal(calls[0], "preflight");
  assert.deepEqual(calls[1], {
    nodeExecutable: "/opt/node",
    runtimeScript: paths.runtimeScript,
    dataRoot: paths.dataRoot,
    codexHome: paths.codexHome
  });
  assert.deepEqual(calls[2], { runtimeState: paths.runtimeState, runtimePid: 8123 });
});

test("a live Runtime lock blocks destructive cleanup when runtime state is missing", async () => {
  const paths = sessionPaths(await temporaryRoot("missing-state"));
  const controller = createRuntimeController({
    paths,
    acquireLease: leaseStub(),
    acquireRuntimeLease: async () => { throw new Error("lock owned by live runtime"); }
  });

  await assert.rejects(
    controller.launch(),
    /Runtime is active but its state is unavailable/
  );
  await assert.rejects(
    controller.shutdown(),
    /Runtime is active but its state is unavailable/
  );
});

test("status has only off, opening, active, and failed states", async () => {
  const paths = sessionPaths(await temporaryRoot("status"));
  await mkdir(paths.runRoot, { recursive: true });
  const controller = createRuntimeController({
    paths,
    acquireLease: leaseStub(),
    matchesRuntime: async () => true
  });

  assert.deepEqual(await controller.status(), { state: "off" });
  await writeFile(paths.runtimeState, JSON.stringify({
    state: "opening", step: "connecting", pid: process.pid, cdpPort: 9444
  }));
  assert.deepEqual(await controller.status(), {
    state: "opening", step: "connecting", pid: process.pid, cdpPort: 9444
  });
  await writeFile(paths.runtimeState, JSON.stringify({
    state: "active", pid: process.pid
  }));
  assert.deepEqual(await controller.status(), {
    state: "active", pid: process.pid
  });
  await writeFile(paths.runtimeState, JSON.stringify({
    state: "failed", pid: 999999, error: "unsupported sidebar"
  }));
  assert.deepEqual(await controller.status(), {
    state: "failed", pid: null, error: "unsupported sidebar"
  });
  await writeFile(paths.runtimeState, JSON.stringify({ state: "active", pid: 999999 }));
  assert.deepEqual(await controller.status(), { state: "off", staleRuntime: true });
});

test("launch reports an existing live Runtime without reopening another Desktop", async () => {
  const paths = sessionPaths(await temporaryRoot("reopen"));
  await mkdir(paths.runRoot, { recursive: true });
  await writeFile(paths.runtimeState, JSON.stringify({
    state: "active",
    pid: process.pid,
    desktopPid: null,
    appServerUrl: "ws://127.0.0.1:4567/"
  }));
  let started = false;
  const controller = createRuntimeController({
    paths,
    startRuntime: () => { started = true; return { pid: 999 }; },
    acquireLease: leaseStub(),
    matchesRuntime: async () => true
  });

  assert.deepEqual(await controller.launch(), { status: "already_active", pid: process.pid });
  assert.equal(started, false);
});

test("shutdown signals only the validated live CodexAgentTeam Runtime", async () => {
  const paths = sessionPaths(await temporaryRoot("close"));
  await mkdir(paths.runRoot, { recursive: true });
  await writeFile(paths.runtimeState, JSON.stringify({ state: "active", pid: process.pid }));
  const signals = [];
  const controller = createRuntimeController({
    paths,
    acquireLease: leaseStub(),
    matchesRuntime: async () => true,
    signalRuntime: (pid) => signals.push(pid)
  });

  assert.deepEqual(await controller.shutdown(), { status: "accepted" });
  assert.deepEqual(signals, [process.pid]);
});

test("a reused PID is rejected when it is not the CodexAgentTeam Runtime process", async () => {
  const paths = sessionPaths(await temporaryRoot("reused-pid"));
  await mkdir(paths.runRoot, { recursive: true });
  await writeFile(paths.runtimeState, JSON.stringify({ state: "active", pid: process.pid }));
  const signals = [];
  const controller = createRuntimeController({
    paths,
    acquireLease: leaseStub(),
    matchesRuntime: async () => false,
    signalRuntime: (pid) => signals.push(pid)
  });

  assert.deepEqual(await controller.status(), { state: "off", staleRuntime: true });
  assert.deepEqual(await controller.shutdown(), { status: "already_inactive" });
  assert.deepEqual(signals, []);
});

test("shutting down an inactive run cleans only disposable CodexAgentTeam runtime bundles", async () => {
  const root = await temporaryRoot("inactive-cleanup");
  const paths = sessionPaths(root);
  await mkdir(paths.runtimeBundleRoot, { recursive: true });
  await mkdir(paths.runtimeStagingRoot, { recursive: true });
  await writeFile(path.join(paths.runtimeBundleRoot, "stale.mjs"), "// stale\n");
  await writeFile(path.join(paths.runtimeStagingRoot, "stale.mjs"), "// stale\n");
  const controller = createRuntimeController({
    paths,
    acquireLease: leaseStub()
  });

  assert.deepEqual(await controller.shutdown(), { status: "already_inactive" });
  await assert.rejects(access(paths.runtimeBundleRoot), { code: "ENOENT" });
  await assert.rejects(access(paths.runtimeStagingRoot), { code: "ENOENT" });
});

test("concurrent public operations are serialized by one short-lived lease", async () => {
  const paths = sessionPaths(await temporaryRoot("operation-lock"));
  let held = false;
  let releasePreflight;
  const gate = new Promise((resolve) => { releasePreflight = resolve; });
  const controller = createRuntimeController({
    paths,
    preflight: async () => gate,
    startRuntime: () => ({ pid: process.pid }),
    waitForStart: async () => {},
    acquireLease: async () => {
      if (held) throw new Error("concurrent operation");
      held = true;
      return { async release() { held = false; } };
    }
  });

  const first = controller.launch();
  await Promise.resolve();
  await assert.rejects(controller.launch(), /concurrent operation/);
  releasePreflight();
  assert.deepEqual(await first, { status: "launched", pid: process.pid });
  assert.equal(held, false);
});

test("preflight installs a self-contained Runtime only after capability checks pass", async () => {
  const root = await temporaryRoot("preflight");
  const pluginRoot = path.join(root, "plugin");
  const scriptsRoot = path.join(pluginRoot, "scripts");
  const assetsRoot = path.join(pluginRoot, "assets");
  const paths = sessionPaths(root);
  const codexCli = path.join(root, "codex");
  const desktopExecutable = path.join(root, "desktop");
  const nodeExecutable = path.join(root, "node");
  await Promise.all([
    mkdir(path.join(scriptsRoot, "lib", "runtime"), { recursive: true }),
    mkdir(assetsRoot, { recursive: true }),
    writeFile(codexCli, "#!/bin/sh\n", { mode: 0o755 }),
    writeFile(desktopExecutable, "#!/bin/sh\n", { mode: 0o755 }),
    writeFile(nodeExecutable, "#!/bin/sh\n", { mode: 0o755 })
  ]);
  await writeFile(path.join(scriptsRoot, "lib", "runtime", "run.mjs"), "// runtime\n");
  await writeFile(path.join(assetsRoot, "avatar.txt"), "asset\n");
  const probes = [];

  await prepareRuntimeBundle({
    paths,
    scriptsRoot,
    codexCli,
    desktopExecutable,
    nodeExecutable,
    probeAppServer: async (options) => probes.push(options),
    execFileImpl: async (_command, args) => args[0] === "--version"
      ? { stdout: "codex 1.0\n" }
      : { stdout: "--listen ws://IP:PORT\n" }
  });

  assert.equal(probes.length, 1);
  assert.equal(probes[0].codexHome, paths.codexHome);
  await access(path.join(paths.runtimeBundleRoot, "scripts", "lib", "runtime", "run.mjs"));
  await access(path.join(paths.runtimeBundleRoot, "assets", "avatar.txt"));
});

test("preflight retries one transient Codex capability probe failure", async () => {
  const root = await temporaryRoot("preflight-retry");
  const pluginRoot = path.join(root, "plugin");
  const scriptsRoot = path.join(pluginRoot, "scripts");
  const assetsRoot = path.join(pluginRoot, "assets");
  const paths = sessionPaths(root);
  const codexCli = path.join(root, "codex");
  const desktopExecutable = path.join(root, "desktop");
  const nodeExecutable = path.join(root, "node");
  await Promise.all([
    mkdir(path.join(scriptsRoot, "lib", "runtime"), { recursive: true }),
    mkdir(assetsRoot, { recursive: true }),
    writeFile(codexCli, "#!/bin/sh\n", { mode: 0o755 }),
    writeFile(desktopExecutable, "#!/bin/sh\n", { mode: 0o755 }),
    writeFile(nodeExecutable, "#!/bin/sh\n", { mode: 0o755 })
  ]);
  await Promise.all([
    writeFile(path.join(scriptsRoot, "lib", "runtime", "run.mjs"), "// runtime\n"),
    writeFile(path.join(assetsRoot, "avatar.txt"), "asset\n")
  ]);
  let helpAttempts = 0;

  await prepareRuntimeBundle({
    paths,
    scriptsRoot,
    codexCli,
    desktopExecutable,
    nodeExecutable,
    probeAppServer: async () => {},
    retryDelayMs: 0,
    execFileImpl: async (_command, args) => {
      if (args[0] === "--version") return { stdout: "codex 1.0\n" };
      if (args[0] === "app-server") {
        helpAttempts += 1;
        if (helpAttempts === 1) throw new Error("transient CLI failure");
        return { stdout: "--listen ws://IP:PORT\n" };
      }
      return { stdout: "" };
    }
  });

  assert.equal(helpAttempts, 2);
});

test("normal Team Desktop exit immediately stops the CodexAgentTeam-owned App Server", async () => {
  const events = [];
  const appServer = {
    ownership: "agent-team-app-server",
    disconnected: new Promise(() => {})
  };
  const desktop = {
    pid: 8001,
    exited: Promise.resolve({ code: 0, signal: null })
  };

  const result = await runRuntimeSession({
    connectAppServer: async () => { events.push("app-server:start"); return appServer; },
    disconnectAppServer: async (client) => { assert.equal(client, appServer); events.push("app-server:stop"); },
    startDesktop: async () => { events.push("desktop:start"); return desktop; },
    attachDesktop: async () => events.push("desktop:attach"),
    detachDesktop: async () => events.push("desktop:detach"),
    disposeDesktop: async () => events.push("desktop:dispose"),
    waitForStop: async () => new Promise(() => {}),
    requestDesktopQuit: async () => events.push("desktop:quit"),
    waitForDesktopExit: async () => events.push("desktop:exit"),
    publish: async (status) => events.push(`state:${status.state}:${status.step ?? ""}`)
  });

  assert.equal(result, "closed");
  assert.deepEqual(events, [
    "app-server:start",
    "state:opening:connecting",
    "desktop:start",
    "state:opening:attaching",
    "desktop:attach",
    "state:active:",
    "desktop:detach",
    "desktop:dispose",
    "app-server:stop"
  ]);
});

test("an unexpected owned App Server exit closes only the Team Desktop and fails the run", async () => {
  const events = [];
  await assert.rejects(runRuntimeSession({
    connectAppServer: async () => ({
      ownership: "agent-team-app-server",
      disconnected: Promise.resolve(new Error("daemon socket closed"))
    }),
    disconnectAppServer: async () => events.push("app-server:stop"),
    startDesktop: async () => ({ pid: 8001, exited: new Promise(() => {}) }),
    attachDesktop: async () => events.push("desktop:attach"),
    detachDesktop: async () => events.push("desktop:detach"),
    disposeDesktop: async () => events.push("desktop:dispose"),
    waitForStop: async () => new Promise(() => {}),
    requestDesktopQuit: async () => events.push("desktop:quit"),
    waitForDesktopExit: async () => events.push("desktop:exit"),
    publish: async () => {}
  }), /daemon socket closed/);

  assert.deepEqual(events, [
    "desktop:attach",
    "desktop:quit",
    "desktop:exit",
    "desktop:detach",
    "desktop:dispose",
    "app-server:stop"
  ]);
});

test("a live Desktop adapter failure stops only the current run and releases its App Server", async () => {
  const events = [];
  const result = await runRuntimeSession({
    connectAppServer: async () => ({
      ownership: "agent-team-app-server",
      disconnected: new Promise(() => {})
    }),
    disconnectAppServer: async () => events.push("app-server:stop"),
    startDesktop: async () => ({ pid: 8001, exited: new Promise(() => {}) }),
    attachDesktop: async () => events.push("desktop:attach"),
    detachDesktop: async () => events.push("desktop:detach"),
    disposeDesktop: async () => events.push("desktop:dispose"),
    waitForStop: async () => new Promise(() => {}),
    waitForDesktopFailure: async () => "adapter-failed",
    requestDesktopQuit: async () => events.push("desktop:quit"),
    waitForDesktopExit: async () => events.push("desktop:exit"),
    publish: async () => {}
  });

  assert.equal(result, "adapter-failed");
  assert.deepEqual(events, [
    "desktop:attach",
    "desktop:quit",
    "desktop:exit",
    "desktop:detach",
    "desktop:dispose",
    "app-server:stop"
  ]);
});

test("a state publication failure still stops the CodexAgentTeam-owned App Server", async () => {
  const events = [];
  await assert.rejects(runRuntimeSession({
    connectAppServer: async () => ({
      ownership: "agent-team-app-server",
      disconnected: new Promise(() => {})
    }),
    disconnectAppServer: async () => events.push("app-server:stop"),
    startDesktop: async () => assert.fail("Desktop must not start after publication fails"),
    attachDesktop: async () => {},
    detachDesktop: async () => {},
    waitForStop: async () => new Promise(() => {}),
    requestDesktopQuit: async () => {},
    waitForDesktopExit: async () => {},
    publish: async () => { throw new Error("state unavailable"); }
  }), /state unavailable/);

  assert.deepEqual(events, ["app-server:stop"]);
});

test("a Desktop integration failure leaves neither Desktop nor owned App Server behind", async () => {
  const events = [];
  await assert.rejects(runRuntimeSession({
    connectAppServer: async () => ({
      ownership: "agent-team-app-server",
      disconnected: new Promise(() => {})
    }),
    disconnectAppServer: async () => events.push("app-server:stop"),
    startDesktop: async () => ({ pid: 8001, exited: new Promise(() => {}) }),
    attachDesktop: async () => { events.push("desktop:attach"); throw new Error("unsupported sidebar"); },
    detachDesktop: async () => events.push("desktop:detach"),
    disposeDesktop: async () => events.push("desktop:dispose"),
    waitForStop: async () => new Promise(() => {}),
    requestDesktopQuit: async () => events.push("desktop:quit"),
    waitForDesktopExit: async () => events.push("desktop:exit"),
    publish: async () => {}
  }), /unsupported sidebar/);

  assert.deepEqual(events, [
    "desktop:attach",
    "desktop:quit",
    "desktop:exit",
    "desktop:detach",
    "desktop:dispose",
    "app-server:stop"
  ]);
});

test("five sequential CodexAgentTeam runs each end without a persistent relaunch loop", async () => {
  const events = [];
  for (let run = 1; run <= 5; run += 1) {
    const result = await runRuntimeSession({
      connectAppServer: async () => ({
        ownership: "agent-team-app-server",
        disconnected: new Promise(() => {})
      }),
      disconnectAppServer: async () => events.push(`run:${run}:stop`),
      startDesktop: async () => ({ pid: 8000 + run, exited: Promise.resolve({ code: 0 }) }),
      attachDesktop: async () => events.push(`run:${run}:attach`),
      detachDesktop: async () => events.push(`run:${run}:detach`),
      disposeDesktop: async () => events.push(`run:${run}:dispose`),
      waitForStop: async () => new Promise(() => {}),
      requestDesktopQuit: async () => assert.fail("a normally closed Desktop must not receive another quit request"),
      waitForDesktopExit: async () => {},
      publish: async () => {}
    });
    assert.equal(result, "closed");
  }
  assert.equal(events.filter((event) => event.endsWith(":attach")).length, 5);
  assert.equal(events.filter((event) => event.endsWith(":stop")).length, 5);
  assert.equal(events.filter((event) => event.endsWith(":dispose")).length, 5);
});

test("detached Runtime receives no ordinary Desktop handoff identity", () => {
  const calls = [];
  const child = { pid: 8123, unref: () => calls.push("unref") };
  const result = spawnRuntimeProcess({
    nodeExecutable: "/opt/node",
    runtimeScript: "/tmp/runtime/lib/runtime/run.mjs",
    dataRoot: "/tmp/agent-team",
    codexHome: "/tmp/codex-home",
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return child;
    }
  });

  assert.equal(result, child);
  assert.equal(calls[0].command, "/opt/node");
  assert.deepEqual(calls[0].args, ["/tmp/runtime/lib/runtime/run.mjs"]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, "ignore");
  assert.equal(calls[0].options.env.CODEX_AGENT_TEAM_HOME, "/tmp/agent-team");
  assert.equal(calls[0].options.env.CODEX_HOME, "/tmp/codex-home");
  assert.equal(calls[0].options.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON, undefined);
  assert.equal(calls.at(-1), "unref");
});

function sessionPaths(root) {
  const dataRoot = path.join(root, ".codex-agent-team");
  const runRoot = path.join(dataRoot, "run");
  const runtimeBundleRoot = path.join(dataRoot, "runtime");
  const runtimeStagingRoot = path.join(dataRoot, "runtime.next");
  return {
    codexHome: path.join(root, ".codex"),
    dataRoot,
    runRoot,
    teamsRoot: path.join(dataRoot, "teams"),
    desktopProfileRoot: path.join(dataRoot, "desktop-profile"),
    operationLockFile: path.join(runRoot, "operation.lock"),
    runtimeLockFile: path.join(runRoot, "runtime.lock"),
    runtimeState: path.join(runRoot, "runtime.json"),
    runtimeLog: path.join(runRoot, "runtime.log"),
    runtimeBundleRoot,
    runtimeScript: path.join(runtimeBundleRoot, "scripts", "lib", "runtime", "run.mjs"),
    runtimeStagingRoot,
    runtimeStagingScriptsRoot: path.join(runtimeStagingRoot, "scripts")
  };
}

function leaseStub() {
  return async () => ({ release: async () => {} });
}

function temporaryRoot(label) {
  return mkdtemp(path.join(os.tmpdir(), `codex-agent-team-${label}-`));
}
