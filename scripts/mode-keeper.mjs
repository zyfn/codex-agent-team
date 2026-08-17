#!/usr/bin/env node
import { appendFile, readFile, unlink, writeFile } from "node:fs/promises";

import {
  configureCodexDesktopTeamTransport,
  isCodexTeamDesktopRunning,
  listCodexDesktopProcessTreePids
} from "./lib/desktop-lifecycle.mjs";
import { ensureDefaultDaemon } from "./lib/daemon.mjs";
import { startDaemonRelay } from "./lib/daemon-relay.mjs";
import {
  createSystemModeLifecycle,
  inspectPersistedMode,
  runModeTransition
} from "./lib/team-mode-manager.mjs";
import { resolveCodexCli, resolveDesktopExecutable, resolvePaths } from "./lib/paths.mjs";

const paths = resolvePaths();
const scriptsRoot = import.meta.dirname;
const codexCli = resolveCodexCli();
const desktopExecutable = resolveDesktopExecutable();
const keeperEnv = { ...process.env, CODEX_AGENT_TEAM_KEEPER_ACTIVE: "1" };
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

await runKeeper();

async function runKeeper() {
  const initialMode = await inspectPersistedMode(paths);
  if (initialMode.mode !== "team") {
    await log("mode keeper skipped: Team mode is not active");
    return;
  }
  const relayPort = Number(initialMode.relayPort);
  if (!Number.isInteger(relayPort) || relayPort <= 0) {
    await writeRelayState({ phase: "failed", error: "Team transport port is missing" });
    throw new Error("Persisted Team mode does not contain a valid transport port");
  }

  await ensureDefaultDaemon(codexCli, {
    codexHome: paths.codexHome,
    socketPath: paths.daemonSocket
  });
  let stateWrites = Promise.resolve();
  const publishStats = (stats) => {
    stateWrites = stateWrites.then(() => writeRelayState({
      phase: "ready",
      port: relayPort,
      ...stats,
      pid: process.pid
    })).catch(() => undefined);
  };
  let relay;
  let failed = false;
  try {
    relay = await startDaemonRelay({
      daemonSocket: paths.daemonSocket,
      port: relayPort,
      onStats: publishStats
    });
    publishStats(relay.getStats());
    await stateWrites;
    await configureCodexDesktopTeamTransport(`ws://127.0.0.1:${relayPort}/rpc`);
    await log(`mode keeper ready relayPort=${relayPort}`);

    while (!stopping) {
      const mode = await inspectPersistedMode(paths);
      if (mode.mode !== "team") break;
      const desktopPids = await listCodexDesktopProcessTreePids({ desktopExecutable }).catch(() => []);
      const teamDesktop = desktopPids.length > 0
        && await isCodexTeamDesktopRunning({ desktopExecutable }).catch(() => false);
      if (desktopPids.length > 0 && !teamDesktop && !await runtimeReady()) {
        const lifecycle = createSystemModeLifecycle({
          paths,
          codexCli,
          desktopExecutable,
          scriptsRoot,
          env: keeperEnv,
          teamRelayPort: relayPort
        });
        await log("restoring Team Desktop");
        await runModeTransition("team", lifecycle).catch((error) => log(`restore failed: ${error?.message ?? String(error)}`));
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  } catch (error) {
    failed = true;
    await stateWrites;
    await writeRelayState({
      phase: "failed",
      port: relayPort,
      pid: process.pid,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
    throw error;
  } finally {
    await relay?.close();
    await stateWrites;
    if (!failed) await unlink(paths.relayState).catch(() => undefined);
  }

  await log("mode keeper stopped");
}

async function runtimeReady() {
  try {
    const state = JSON.parse(await readFile(paths.runtimeState, "utf8"));
    if (state.phase !== "ready" || !Number.isInteger(state.pid)) return false;
    process.kill(state.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function log(message) {
  return appendFile(paths.modeLog, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
}

function writeRelayState(value) {
  return writeFile(paths.relayState, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
