#!/usr/bin/env node

// One detached process for one explicit CodexAgentTeam Desktop run. The ordinary
// Codex Desktop remains untouched; closing this run's Desktop ends the run.

import { appendFile, mkdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";

import { createDesktopBridge } from "./desktop/bridge.mjs";
import {
  isUnexpectedDesktopDisconnect,
  listDesktopStdioAppServerPids,
  requestCodexDesktopQuit,
  waitForChildProcessExit,
  startTeamDesktop,
  stopTeamDesktopHelpers
} from "./desktop/process.mjs";
import { acquireFileLease } from "../file-lease.mjs";
import {
  allocateLoopbackPort,
  startAppServer,
  stopAppServer
} from "./app-server.mjs";
import {
  resolveCodexCli,
  resolveDesktopExecutable,
  resolvePaths
} from "../paths.mjs";
import { runRuntimeSession } from "./session.mjs";

const paths = resolvePaths();
const codexCli = resolveCodexCli();
const desktopExecutable = resolveDesktopExecutable();
const runtimeStartedAt = new Date().toISOString();
let bridge = null;
let teamDesktop = null;
let currentState = "opening";
let stopReason = null;
let resolveStop;
let logQueue = Promise.resolve();
let sessionFailure = null;
let shutdownPromise = null;
const stopSignal = new Promise((resolve) => { resolveStop = resolve; });

const onSigterm = () => requestStop("shutdown");
const onSigint = () => requestStop("shutdown");
process.once("SIGTERM", onSigterm);
process.once("SIGINT", onSigint);

await Promise.all([
  mkdir(paths.runRoot, { recursive: true, mode: 0o700 }),
  mkdir(paths.desktopProfileRoot, { recursive: true, mode: 0o700 })
]);

let runtimeLease;
try {
  runtimeLease = await acquireFileLease(paths.runtimeLockFile, {
    timeoutMs: 0,
    busyMessage: "Another CodexAgentTeam run is already active"
  });
} catch (error) {
  await appendLog(`runtime rejected: ${readableError(error, "runtime lock unavailable")}`)
    .catch(() => undefined);
  process.exitCode = 1;
}

if (runtimeLease) {
  let failure = null;
  try {
    await publish({ state: "opening", step: "starting" });
    if (!stopReason) await runOnce();
  } catch (error) {
    failure = error;
  } finally {
    await shutdown(failure);
  }
}

async function runOnce() {
  const result = await runRuntimeSession({
    connectAppServer: () => startAppServer({
      codexCli,
      codexHome: paths.codexHome,
      clientName: "codex-agent-team-runtime",
      onStderr: (message) => appendLog(`app-server: ${message}`).catch(() => undefined)
    }),
    disconnectAppServer: stopAppServer,
    startDesktop: startRuntimeDesktop,
    attachDesktop,
    detachDesktop,
    disposeDesktop: disposeTeamDesktop,
    waitForStop,
    waitForDesktopFailure: () => sessionFailure?.promise ?? new Promise(() => {}),
    requestDesktopQuit: (desktop) => requestCodexDesktopQuit({ pid: desktop.pid }),
    terminateDesktop: (desktop) => desktop.child?.kill?.("SIGTERM"),
    waitForDesktopExit: (desktop) => waitForChildProcessExit(desktop.child, { timeoutMs: 5_000 }),
    publish
  });
  if (result === "adapter-failed") {
    throw sessionFailure.error ?? new Error("Desktop integration disconnected unexpectedly");
  }
}

async function startRuntimeDesktop(appServer) {
  sessionFailure = deferred();
  const cdpPort = await allocateLoopbackPort();
  teamDesktop = startTeamDesktop({
    desktopExecutable,
    profileRoot: paths.desktopProfileRoot,
    codexHome: paths.codexHome,
    appServerUrl: appServer.url,
    cdpPort
  });
  appServer.registerDesktop?.({ pid: teamDesktop.pid });
  return teamDesktop;
}

async function disposeTeamDesktop(desktop) {
  if (teamDesktop?.pid === desktop.pid) teamDesktop = null;
  if (sessionFailure && !sessionFailure.settled) {
    sessionFailure.settled = true;
    sessionFailure.resolve("desktop-closed");
  }
  await stopTeamDesktopHelpers({ profileRoot: paths.desktopProfileRoot });
}

async function attachDesktop(desktop, appServer) {
  const failure = sessionFailure;
  const candidate = createDesktopBridge({
    paths,
    cdpPort: desktop.cdpPort,
    rpc: appServer.rpc,
    verifyTransport: async () => {
      const stdioPids = await listDesktopStdioAppServerPids({
        desktopPid: desktop.pid,
        desktopExecutable
      });
      if (stdioPids.length) {
        throw new Error(`CodexAgentTeam Codex started an unexpected stdio App Server (${stdioPids.join(", ")})`);
      }
    },
    onDisconnect: (error) => classifyDesktopDisconnect(desktop, failure, error)
  });
  await candidate.attach();
  bridge = candidate;
}

async function detachDesktop() {
  const current = bridge;
  bridge = null;
  await current?.close().catch(() => undefined);
}

async function classifyDesktopDisconnect(desktop, failure, error) {
  if (stopReason || !failure) return;
  const unexpected = await isUnexpectedDesktopDisconnect({ desktopExited: desktop.exited });
  if (!unexpected || stopReason || failure.settled) return;
  failure.error = error instanceof Error
    ? error
    : new Error(readableError(error, "Desktop integration disconnected unexpectedly"));
  failure.settled = true;
  failure.resolve("adapter-failed");
}

async function requestTeamDesktopExit() {
  if (!teamDesktop?.pid) return;
  await requestCodexDesktopQuit({ pid: teamDesktop.pid });
}

async function waitForStop() {
  return stopReason ? Promise.resolve(stopReason) : stopSignal;
}

function requestStop(reason) {
  if (stopReason) return;
  stopReason = reason;
  resolveStop(reason);
}

function shutdown(failure) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    if (teamDesktop?.child?.exitCode === null) {
      await requestTeamDesktopExit().catch((error) =>
        appendLog(`Desktop quit request failed during shutdown: ${error.message}`).catch(() => undefined)
      );
      try {
        await waitForChildProcessExit(teamDesktop.child, { timeoutMs: 5_000 });
      } catch (error) {
        await appendLog(`Desktop native quit timed out; sending SIGTERM to owned PID: ${error.message}`)
          .catch(() => undefined);
        teamDesktop.child.kill("SIGTERM");
        await waitForChildProcessExit(teamDesktop.child, { timeoutMs: 5_000 }).catch((terminateError) =>
          appendLog(`Desktop SIGTERM wait failed during shutdown: ${terminateError.message}`).catch(() => undefined)
        );
      }
    }
    await detachDesktop().catch(() => undefined);
    teamDesktop = null;
    if (failure) {
      const message = readableError(failure, "CodexAgentTeam failed to launch");
      await publish({ state: "failed", error: message }).catch(() => undefined);
      await appendLog(`runtime failed: ${failure instanceof Error ? failure.stack ?? message : message}`)
        .catch(() => undefined);
    } else {
      await rm(paths.runtimeState, { force: true });
    }
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGINT", onSigint);
    await runtimeLease.release();
    await rm(paths.runtimeBundleRoot, { recursive: true, force: true });
  })();
  return shutdownPromise;
}

async function publish(value) {
  currentState = value.state ?? currentState;
  const state = {
    pid: process.pid,
    startedAt: runtimeStartedAt,
    ...value,
    updatedAt: new Date().toISOString()
  };
  const temporary = `${paths.runtimeState}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, paths.runtimeState);
}

function appendLog(message) {
  const write = logQueue.then(async () => {
    const size = await stat(paths.runtimeLog).then((value) => value.size).catch(() => 0);
    if (size >= 2 * 1024 * 1024) {
      const previous = `${paths.runtimeLog}.1`;
      await unlink(previous).catch(() => undefined);
      await rename(paths.runtimeLog, previous).catch(() => undefined);
    }
    await appendFile(paths.runtimeLog, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
  });
  logQueue = write.catch(() => undefined);
  return write;
}

function deferred() {
  let resolve;
  const promise = new Promise((onResolve) => { resolve = onResolve; });
  return { promise, resolve, settled: false, error: null };
}

function readableError(error, fallback) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || fallback;
}
