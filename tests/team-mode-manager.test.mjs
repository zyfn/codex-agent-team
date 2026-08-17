import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createSystemModeLifecycle,
  recoverFailedModeTransition,
  TeamModeManager,
  runModeTransition
} from "../scripts/lib/team-mode-manager.mjs";

test("opening Team mode requires confirmation before any lifecycle change", async () => {
  const effects = [];
  const manager = new TeamModeManager({
    inspectMode: async () => ({ mode: "normal", runtimeReady: false }),
    preflight: async () => effects.push("preflight"),
    transition: async () => effects.push("transition")
  });

  const result = await manager.prepare("team");

  assert.deepEqual(result, {
    status: "confirmation_required",
    target: "team",
    message: "准备完成。确认后将请求 Codex 正常退出并进入团队模式。"
  });
  assert.deepEqual(effects, ["preflight"]);
});

test("confirmed Team transition releases stdio before starting the daemon", async () => {
  const effects = [];
  const manager = new TeamModeManager({
    inspectMode: async () => ({ mode: "normal", runtimeReady: false }),
    preflight: async () => effects.push("preflight"),
    transition: async (target) => effects.push(`transition:${target}`)
  });

  const result = await manager.confirm("team");

  assert.deepEqual(result, { status: "accepted", target: "team" });
  assert.deepEqual(effects, ["preflight", "transition:team"]);
});

test("persisted Team mode is active only when runtime and shared transport are both ready", async () => {
  const effects = [];
  const manager = new TeamModeManager({
    inspectMode: async () => ({ mode: "team", runtimeReady: true, teamTransportReady: false }),
    preflight: async () => effects.push("preflight"),
    transition: async () => effects.push("transition")
  });

  assert.equal((await manager.prepare("team")).status, "confirmation_required");
  assert.deepEqual(effects, ["preflight"]);
});

test("confirmed normal transition uses the same interface", async () => {
  const effects = [];
  const manager = new TeamModeManager({
    inspectMode: async () => ({ mode: "team", runtimeReady: true }),
    preflight: async () => effects.push("preflight"),
    transition: async (target) => effects.push(`transition:${target}`)
  });

  assert.deepEqual(await manager.confirm("normal"), { status: "accepted", target: "normal" });
  assert.deepEqual(effects, ["preflight", "transition:normal"]);
});

test("normal recovery still runs when an older build left the Desktop pinned to daemon mode", async () => {
  const effects = [];
  const manager = new TeamModeManager({
    inspectMode: async () => ({ mode: "normal", runtimeReady: false, daemonEnvironment: true }),
    preflight: async () => effects.push("preflight"),
    transition: async () => effects.push("transition")
  });

  assert.equal((await manager.prepare("normal")).status, "confirmation_required");
  assert.deepEqual(effects, ["preflight"]);
});

test("Team transition never overlaps the native stdio App Server with the daemon", async () => {
  const effects = [];
  await runModeTransition("team", lifecycleRecorder(effects));

  assert.deepEqual(effects, [
    "request-native-quit",
    "wait-desktop-exit",
    "start-daemon",
    "prepare-team-transport",
    "persist:team",
    "set-daemon-environment",
    "install-keeper",
    "wait-team-transport",
    "launch-team-desktop",
    "start-runtime",
    "verify-team-transport"
  ]);
});

test("normal transition stops the daemon before restoring native stdio Desktop", async () => {
  const effects = [];
  await runModeTransition("normal", lifecycleRecorder(effects));

  assert.deepEqual(effects, [
    "request-native-quit",
    "wait-desktop-exit",
    "stop-runtime",
    "remove-keeper",
    "persist:normal",
    "unset-daemon-environment",
    "stop-daemon",
    "clear-runtime-state",
    "launch-normal-desktop",
  ]);
});

test("a failed daemon stop leaves a durable normal intent and never launches stdio beside it", async () => {
  const effects = [];
  const lifecycle = lifecycleRecorder(effects);
  lifecycle.stopDaemon = async () => {
    effects.push("stop-daemon");
    throw new Error("app server is running but is not managed by codex app-server daemon");
  };

  await assert.rejects(runModeTransition("normal", lifecycle), /not managed/);

  assert.deepEqual(effects, [
    "request-native-quit",
    "wait-desktop-exit",
    "stop-runtime",
    "remove-keeper",
    "persist:normal",
    "unset-daemon-environment",
    "stop-daemon"
  ]);
});

test("normal-mode failure recovery never rolls the user back into Team mode", async () => {
  const effects = [];

  const result = await recoverFailedModeTransition({
    target: "normal",
    previous: { mode: "team" },
    lifecycle: lifecycleRecorder(effects),
    desktopPids: []
  });

  assert.deepEqual(result, { restoredMode: null, cleanupErrors: [] });
  assert.deepEqual(effects, [
    "remove-keeper",
    "persist:normal",
    "unset-daemon-environment"
  ]);
});

test("failed Team transport verification returns to native stdio mode", async () => {
  const effects = [];

  const result = await recoverFailedModeTransition({
    target: "team",
    previous: { mode: "normal" },
    lifecycle: lifecycleRecorder(effects),
    desktopPids: [100]
  });

  assert.deepEqual(result, { restoredMode: "normal", cleanupErrors: [] });
  assert.deepEqual(effects, [
    "request-native-quit",
    "wait-desktop-exit",
    "stop-runtime",
    "remove-keeper",
    "persist:normal",
    "unset-daemon-environment",
    "stop-daemon",
    "clear-runtime-state",
    "launch-normal-desktop"
  ]);
});

test("mode keeper is copied to a stable data path before LaunchAgent registration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-mode-"));
  const scriptsRoot = path.join(root, "plugin-cache", "scripts");
  const sourceAssetsRoot = path.join(root, "plugin-cache", "assets");
  const keeperBundleRoot = path.join(root, "data", "mode-runtime");
  const keeperRoot = path.join(keeperBundleRoot, "scripts");
  const builtInAssetsRoot = path.join(keeperBundleRoot, "assets");
  const launchAgentFile = path.join(root, "LaunchAgents", "keeper.plist");
  const invocations = [];
  await mkdir(scriptsRoot, { recursive: true });
  await mkdir(path.join(sourceAssetsRoot, "avatars"), { recursive: true });
  await writeFile(path.join(scriptsRoot, "mode-keeper.mjs"), "// stable keeper\n");
  await writeFile(path.join(sourceAssetsRoot, "avatars", "octopus-engineer.jpg"), "avatar");

  try {
    const lifecycle = createSystemModeLifecycle({
      paths: {
        keeperBundleRoot,
        keeperRoot,
        builtInAssetsRoot,
        launchAgentFile,
        launchAgentLabel: "com.example.keeper",
        modeLog: path.join(root, "mode.log"),
        codexHome: path.join(root, "codex-home")
      },
      codexCli: "/usr/bin/true",
      desktopExecutable: "/Applications/Codex.app/Contents/MacOS/ChatGPT",
      scriptsRoot,
      env: {},
      execFileImpl: async (command, args) => invocations.push([command, ...args])
    });

    await lifecycle.installKeeper();

    assert.equal(await readFile(path.join(keeperRoot, "mode-keeper.mjs"), "utf8"), "// stable keeper\n");
    assert.equal(
      await readFile(path.join(builtInAssetsRoot, "avatars", "octopus-engineer.jpg"), "utf8"),
      "avatar"
    );
    const plist = await readFile(launchAgentFile, "utf8");
    assert.match(plist, new RegExp(escapeRegExp(path.join(keeperRoot, "mode-keeper.mjs"))));
    assert.doesNotMatch(plist, new RegExp(escapeRegExp(scriptsRoot)));
    assert.equal(invocations.at(-1)?.[1], "bootstrap");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Team transport is persisted for reopen while normal Desktop starts with native stdio environment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-transport-"));
  const dataRoot = path.join(root, "data");
  const runRoot = path.join(dataRoot, "run");
  const modeFile = path.join(dataRoot, "mode.json");
  const invocations = [];
  const spawnImpl = (command, args, options) => {
    invocations.push({ command, args, options });
    const child = new EventEmitter();
    child.pid = 1234;
    child.unref = () => {};
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  };
  const lifecycle = createSystemModeLifecycle({
    paths: {
      dataRoot,
      runRoot,
      modeFile,
      relayState: path.join(runRoot, "relay.json"),
      runtimeSocket: path.join(runRoot, "runtime.sock"),
      runtimeState: path.join(runRoot, "runtime.json"),
      daemonSocket: path.join(root, "daemon.sock")
    },
    codexCli: "/usr/bin/true",
    desktopExecutable: "/Applications/Codex.app/Contents/MacOS/ChatGPT",
    scriptsRoot: path.join(root, "scripts"),
    env: {
      PATH: process.env.PATH,
      CODEX_APP_SERVER_USE_LOCAL_DAEMON: "stale",
      CODEX_APP_SERVER_WS_URL: "ws://127.0.0.1:1/rpc"
    },
    spawnImpl
  });

  try {
    await mkdir(runRoot, { recursive: true });
    await lifecycle.prepareTeamTransport();
    await lifecycle.persistMode("team");
    await lifecycle.setDaemonEnvironment();
    const persisted = JSON.parse(await readFile(modeFile, "utf8"));
    assert.ok(Number.isInteger(persisted.relayPort) && persisted.relayPort > 0);
    assert.ok(invocations.some(({ args }) => args?.[1] === "CODEX_APP_SERVER_WS_URL"
      && args?.[2] === `ws://127.0.0.1:${persisted.relayPort}/rpc`));

    await lifecycle.launchNormalDesktop();
    const normalLaunch = invocations.at(-1);
    assert.equal(normalLaunch.options.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON, undefined);
    assert.equal(normalLaunch.options.env.CODEX_APP_SERVER_WS_URL, undefined);

    await lifecycle.persistMode("normal");
    assert.equal(JSON.parse(await readFile(modeFile, "utf8")).relayPort, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function lifecycleRecorder(effects) {
  return {
    requestNativeQuit: async () => effects.push("request-native-quit"),
    waitForDesktopExit: async () => effects.push("wait-desktop-exit"),
    startDaemon: async () => effects.push("start-daemon"),
    stopDaemon: async () => effects.push("stop-daemon"),
    setDaemonEnvironment: async () => effects.push("set-daemon-environment"),
    unsetDaemonEnvironment: async () => effects.push("unset-daemon-environment"),
    launchTeamDesktop: async () => effects.push("launch-team-desktop"),
    launchNormalDesktop: async () => effects.push("launch-normal-desktop"),
    startRuntime: async () => effects.push("start-runtime"),
    stopRuntime: async () => effects.push("stop-runtime"),
    prepareTeamTransport: async () => effects.push("prepare-team-transport"),
    waitForTeamTransport: async () => effects.push("wait-team-transport"),
    verifyTeamTransport: async () => effects.push("verify-team-transport"),
    clearRuntimeState: async () => effects.push("clear-runtime-state"),
    persistMode: async (mode) => effects.push(`persist:${mode}`),
    installKeeper: async () => effects.push("install-keeper"),
    removeKeeper: async () => effects.push("remove-keeper")
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
