import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { acquireFileLease } from "../file-lease.mjs";
import {
  cleanCodexEnvironment,
  probeAppServerCapabilities,
} from "./app-server.mjs";
import { prepareRuntimeBundle } from "./bundle.mjs";
import { readRuntimeState, runtimeIsLive } from "./state.mjs";

export { prepareRuntimeBundle } from "./bundle.mjs";

/**
 * Launch one explicit CodexAgentTeam run without taking ownership of the ordinary
 * Codex Desktop that requested it.
 */
export function createRuntimeController({
  paths,
  scriptsRoot,
  codexCli,
  desktopExecutable,
  nodeExecutable = process.execPath,
  probeAppServer = probeAppServerCapabilities,
  preflight,
  startRuntime = spawnRuntimeProcess,
  waitForStart = waitForRuntimeStart,
  signalRuntime = (pid) => process.kill(pid, "SIGTERM"),
  acquireLease = acquireFileLease,
  acquireRuntimeLease = acquireFileLease,
}) {
  const controller = {};
  controller.paths = paths;
  controller.scriptsRoot = scriptsRoot;
  controller.codexCli = codexCli;
  controller.desktopExecutable = desktopExecutable;
  controller.nodeExecutable = nodeExecutable;
  controller.preflight =
    preflight ??
    (() =>
      prepareRuntimeBundle({
        paths,
        scriptsRoot,
        codexCli,
        desktopExecutable,
        nodeExecutable,
        probeAppServer,
      }));
  controller.startRuntime = startRuntime;
  controller.waitForStart = waitForStart;
  controller.signalRuntime = signalRuntime;
  controller.acquireLease = acquireLease;
  controller.acquireRuntimeLease = acquireRuntimeLease;
  controller.launch = function launch() {
    return controller._withOperationLease(() => controller._launch());
  };
  controller._launch = async function _launch() {
    const current = await controller.status();
    if (["opening", "active"].includes(current.state)) {
      return {
        status: "already_active",
        pid: current.pid ?? null,
      };
    }
    await controller._assertNoLiveRuntime();
    await controller.preflight();
    await rm(controller.paths.runtimeState, { force: true });
    const child = controller.startRuntime({
      nodeExecutable: controller.nodeExecutable,
      runtimeScript: controller.paths.runtimeScript,
      dataRoot: controller.paths.dataRoot,
      codexHome: controller.paths.codexHome,
    });
    if (!Number.isInteger(child?.pid) || child.pid <= 0) {
      throw new Error("CodexAgentTeam Runtime process identifier is unavailable");
    }
    await controller.waitForStart({
      runtimeState: controller.paths.runtimeState,
      runtimePid: child.pid,
    });
    return {
      status: "launched",
      pid: child.pid,
    };
  };
  controller.shutdown = function shutdown() {
    return controller._withOperationLease(() => controller._shutdown());
  };
  controller._shutdown = async function _shutdown() {
    const current = await controller.status();
    if (!["opening", "active"].includes(current.state)) {
      await controller._cleanupInactiveRun();
      return { status: "already_inactive" };
    }
    controller.signalRuntime(current.pid);
    return { status: "accepted" };
  };
  controller.status = async function status() {
    const runtime = await readRuntimeState(controller.paths.runtimeState);
    if (!runtime) return { state: "off" };
    if (runtime.state === "failed") {
      return {
        ...runtimeDetail(runtime),
        state: "failed",
        pid: null,
        error: runtime.error || "CodexAgentTeam failed to launch",
      };
    }
    if (!runtimeIsLive(runtime))
      return {
        state: "off",
        staleRuntime: true,
      };
    if (runtime.state === "active")
      return {
        ...runtimeDetail(runtime),
        state: "active",
      };
    return {
      ...runtimeDetail(runtime),
      state: "opening",
      step: runtime.step || "starting",
    };
  };
  controller._cleanupInactiveRun = async function _cleanupInactiveRun() {
    await controller._assertNoLiveRuntime();
    await Promise.all([
      rm(controller.paths.runtimeState, { force: true }),
      rm(controller.paths.runtimeStagingRoot, {
        recursive: true,
        force: true,
      }),
      rm(controller.paths.runtimeBundleRoot, {
        recursive: true,
        force: true,
      }),
    ]);
  };
  controller._withOperationLease = async function _withOperationLease(action) {
    const lease = await controller.acquireLease(controller.paths.operationLockFile, {
      busyMessage: "Another CodexAgentTeam operation is already in progress",
    });
    try {
      return await action();
    } finally {
      await lease.release();
    }
  };
  controller._assertNoLiveRuntime = async function _assertNoLiveRuntime() {
    let lease;
    try {
      lease = await controller.acquireRuntimeLease(controller.paths.runtimeLockFile, {
        timeoutMs: 0,
        busyMessage: "CodexAgentTeam Runtime is already active",
      });
    } catch (error) {
      throw new Error(
        "CodexAgentTeam Runtime is active but its state is unavailable; run diagnose before retrying",
        { cause: error },
      );
    }
    await lease.release();
  };
  return controller;
}
export function spawnRuntimeProcess({
  nodeExecutable,
  runtimeScript,
  dataRoot,
  codexHome,
  spawnImpl = spawn,
}) {
  const child = spawnImpl(nodeExecutable, [runtimeScript], {
    detached: true,
    stdio: "ignore",
    env: {
      ...cleanCodexEnvironment({ CODEX_HOME: codexHome }),
      CODEX_AGENT_TEAM_HOME: dataRoot,
    },
  });
  child.unref?.();
  return child;
}
async function waitForRuntimeStart({
  runtimeState,
  runtimePid,
  timeoutMs = 30_000,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runtime = await readRuntimeState(runtimeState);
    if (runtime?.pid === runtimePid && runtime.state === "active")
      return runtime;
    if (runtime?.pid === runtimePid && runtime.state === "failed") {
      throw new Error(runtime.error || "CodexAgentTeam failed to launch");
    }
    if (!processAlive(runtimePid))
      throw new Error("CodexAgentTeam Runtime exited before startup completed");
    await delay(25);
  }
  throw new Error("Timed out waiting for CodexAgentTeam Runtime to start");
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
function runtimeDetail(runtime) {
  if (!runtime || typeof runtime !== "object") return {};
  return Object.fromEntries(
    [
      "pid",
      "startedAt",
      "updatedAt",
      "step",
      "appServerPid",
      "appServerGuardianPid",
      "appServerUrl",
      "desktopPid",
      "cdpPort",
    ]
      .filter((key) => runtime[key] !== undefined)
      .map((key) => [key, runtime[key]]),
  );
}
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
