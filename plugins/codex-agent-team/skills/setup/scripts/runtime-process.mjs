#!/usr/bin/env node
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import process from "node:process";

import { AppServerClient } from "./lib/app-server-client.mjs";
import { loadBuiltInAvatars } from "./lib/builtin-avatars.mjs";
import { DesktopCdpClient, watchCdpEndpoint } from "./lib/desktop-cdp.mjs";
import { DesktopProjectAdapter } from "./lib/desktop-project-adapter.mjs";
import { startIpcServer } from "./lib/ipc.mjs";
import { resolvePaths } from "./lib/paths.mjs";
import { RuntimeHost } from "./lib/runtime-host.mjs";
import { TeamService } from "./lib/team-service.mjs";
import { TeamStore } from "./lib/team-store.mjs";
import { launchModeTransition } from "./lib/team-mode-manager.mjs";

const cdpPort = Number.parseInt(process.env.CODEX_AGENT_TEAM_CDP_PORT ?? "", 10);
if (!Number.isInteger(cdpPort) || cdpPort <= 0) throw new Error("CODEX_AGENT_TEAM_CDP_PORT is required");

const paths = resolvePaths();
await mkdir(paths.runRoot, { recursive: true });
const lease = await acquireLease(paths);
await unlink(paths.runtimeSocket).catch(() => undefined);
let rpc;
let cdp;
let host;
let server;
let disposeNotifications;
let disposeCdpDisconnect;
let disposeCdpEndpointWatch;
let refreshTimer;
const startedAt = new Date().toISOString();

try {
  rpc = new AppServerClient({ socketPath: paths.daemonSocket });
  await rpc.connect();
  cdp = await connectCdpWithRetry(cdpPort, 40_000);
  disposeCdpDisconnect = cdp.onDisconnect(() => void shutdown(0, { desktopUnavailable: true }));
  disposeCdpEndpointWatch = watchCdpEndpoint(cdpPort, () => void shutdown(0, { desktopUnavailable: true }));
  const store = new TeamStore(paths.teamsFile);
  const projectAdapter = new DesktopProjectAdapter({ cdp });
  const service = new TeamService({
    store,
    rpc,
    workspaceRoot: paths.workspaceRoot,
    dataRoot: paths.dataRoot,
    projectAdapter
  });
  host = new RuntimeHost({
    service,
    cdp,
    builtInAvatars: await loadBuiltInAvatars(),
    transportUrl: process.env.CODEX_APP_SERVER_WS_URL ?? null,
    onClose: () => launchModeTransition({
      target: "normal",
      paths,
      scriptsRoot: import.meta.dirname
    })
  });
  await host.attach();
  disposeNotifications = rpc.onNotification((method) => {
    if (!/^(thread|turn|item)\//.test(method)) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => host.refresh().catch(() => undefined), 250);
  });
  server = await startIpcServer(paths.runtimeSocket, async (command) => {
    if (command.type === "status") return runtimeStatus("ready");
    if (command.type === "snapshot") return service.snapshot();
    if (command.type === "send") return service.sendMessage(command);
    if (command.type === "refresh") { await host.refresh(); return { refreshed: true }; }
    if (command.type === "stop") {
      setTimeout(() => shutdown(0), 20);
      return { stopped: true };
    }
    throw new Error(`Unknown Team Runtime command: ${String(command.type)}`);
  });
  await writeState(paths.runtimeState, runtimeStatus("ready"));
} catch (error) {
  await writeState(paths.runtimeState, {
    ...runtimeStatus("failed"),
    error: error instanceof Error ? error.message : String(error)
  }).catch(() => undefined);
  await shutdown(1, { preserveState: true });
}

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));

function runtimeStatus(phase) {
  return { phase, pid: process.pid, cdpPort, startedAt };
}

async function shutdown(code, { preserveState = false, desktopUnavailable = false } = {}) {
  if (shutdown.started) return;
  shutdown.started = true;
  clearTimeout(refreshTimer);
  disposeNotifications?.();
  disposeCdpDisconnect?.();
  disposeCdpEndpointWatch?.();
  if (!desktopUnavailable) await host?.close().catch(() => undefined);
  cdp?.close();
  rpc?.close();
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  await unlink(paths.runtimeSocket).catch(() => undefined);
  if (!preserveState) await unlink(paths.runtimeState).catch(() => undefined);
  await lease?.close().catch(() => undefined);
  await unlink(`${paths.runtimeState}.lock`).catch(() => undefined);
  process.exit(code);
}

async function acquireLease(targets) {
  const lockPath = `${targets.runtimeState}.lock`;
  try {
    return await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    try {
      const state = JSON.parse(await readFile(targets.runtimeState, "utf8"));
      process.kill(state.pid, 0);
      throw new Error(`Team Runtime is already running (PID ${state.pid})`);
    } catch (probeError) {
      if (probeError?.code === "EPERM" || !probeError?.code) throw probeError;
      await unlink(lockPath).catch(() => undefined);
      return open(lockPath, "wx", 0o600);
    }
  }
}

async function connectCdpWithRetry(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return await DesktopCdpClient.connect(port); }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Codex Desktop CDP did not become ready: ${lastError?.message ?? "unknown error"}`);
}

async function writeState(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
