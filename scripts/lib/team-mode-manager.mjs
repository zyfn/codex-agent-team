import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { access, cp, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ensureDefaultDaemon, stopDefaultDaemon } from "./daemon.mjs";
import { sendIpc } from "./ipc.mjs";
import {
  configureCodexDesktopTeamTransport,
  hasDesktopStdioAppServerSnapshot,
  listCodexDesktopProcessTreePids,
  requestCodexDesktopQuit,
  restoreCodexDesktopStdioMode,
  waitForDesktopPidsExit
} from "./desktop-lifecycle.mjs";

const TARGETS = new Set(["team", "normal"]);
const execFileAsync = promisify(execFile);

export class TeamModeManager {
  constructor({ inspectMode, preflight, transition }) {
    this.inspectMode = inspectMode;
    this.preflight = preflight;
    this.transition = transition;
  }

  async prepare(target) {
    validateTarget(target);
    const current = await this.inspectMode();
    if (isAlreadyInTarget(current, target)) {
      return { status: "already_active", target };
    }
    await this.preflight(target);
    return {
      status: "confirmation_required",
      target,
      message: target === "team"
        ? "准备完成。确认后将请求 Codex 正常退出并进入团队模式。"
        : "准备完成。确认后将请求 Codex 正常退出并恢复普通模式。"
    };
  }

  async confirm(target) {
    validateTarget(target);
    const current = await this.inspectMode();
    if (isAlreadyInTarget(current, target)) {
      return { status: "already_active", target };
    }
    await this.preflight(target);
    await this.transition(target);
    return { status: "accepted", target };
  }
}

export async function runModeTransition(target, lifecycle) {
  validateTarget(target);
  if (target === "team") {
    await lifecycle.requestNativeQuit();
    await lifecycle.waitForDesktopExit();
    await lifecycle.startDaemon();
    await lifecycle.prepareTeamTransport();
    await lifecycle.persistMode("team");
    await lifecycle.setDaemonEnvironment();
    await lifecycle.installKeeper();
    await lifecycle.waitForTeamTransport();
    await lifecycle.launchTeamDesktop();
    await lifecycle.startRuntime();
    await lifecycle.verifyTeamTransport();
    return;
  }

  await lifecycle.requestNativeQuit();
  await lifecycle.waitForDesktopExit();
  await lifecycle.stopRuntime();
  await lifecycle.removeKeeper();
  await lifecycle.persistMode("normal");
  await lifecycle.unsetDaemonEnvironment();
  await lifecycle.stopDaemon();
  await lifecycle.clearRuntimeState();
  await lifecycle.launchNormalDesktop();
}

export async function recoverFailedModeTransition({ target, previous, lifecycle, desktopPids = [] }) {
  validateTarget(target);
  if (target === "normal") {
    const cleanupErrors = [];
    for (const [label, action] of [
      ["remove keeper", () => lifecycle.removeKeeper()],
      ["persist normal mode", () => lifecycle.persistMode("normal")],
      ["unset daemon environment", () => lifecycle.unsetDaemonEnvironment()]
    ]) {
      try {
        await action();
      } catch (error) {
        cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { restoredMode: null, cleanupErrors };
  }

  await runModeTransition("normal", lifecycle);
  return { restoredMode: "normal", cleanupErrors: [] };
}

export async function launchModeTransition({ target, paths, scriptsRoot, env = process.env, spawnImpl = spawn }) {
  validateTarget(target);
  await mkdir(paths.runRoot, { recursive: true });
  const child = spawnImpl(process.execPath, [path.join(scriptsRoot, "mode-transition.mjs"), target], {
    detached: true,
    stdio: "ignore",
    env: { ...env, CODEX_AGENT_TEAM_SCRIPTS_ROOT: scriptsRoot }
  });
  child.unref?.();
  return { pid: child.pid, target };
}

export function createSystemModeLifecycle({
  paths,
  codexCli,
  desktopExecutable,
  scriptsRoot,
  env = process.env,
  spawnImpl = spawn,
  execFileImpl = execFileAsync,
  teamRelayPort = null
}) {
  let desktopPids = [];
  let cdpPort;
  let relayPort = Number.isInteger(teamRelayPort) && teamRelayPort > 0 ? teamRelayPort : null;
  let teamDesktopPid = null;

  return {
    async requestNativeQuit() {
      desktopPids = await listCodexDesktopProcessTreePids({ desktopExecutable });
      if (desktopPids.length > 0) await requestCodexDesktopQuit({ spawnImpl });
    },
    async waitForDesktopExit() {
      if (desktopPids.length > 0) await waitForDesktopPidsExit(desktopPids, 60_000);
    },
    async startDaemon() {
      await ensureDefaultDaemon(codexCli, {
        codexHome: paths.codexHome,
        socketPath: paths.daemonSocket
      });
    },
    async prepareTeamTransport() {
      relayPort ??= await freePort();
    },
    async stopDaemon() {
      await stopDefaultDaemon(codexCli, {
        codexHome: paths.codexHome,
        socketPath: paths.daemonSocket
      });
    },
    async setDaemonEnvironment() {
      await configureCodexDesktopTeamTransport(teamTransportUrl(relayPort), { spawnImpl });
    },
    async unsetDaemonEnvironment() {
      await restoreCodexDesktopStdioMode({ spawnImpl });
    },
    async launchTeamDesktop() {
      cdpPort = await freePort();
      const desktopEnv = desktopEnvironment(env);
      desktopEnv.CODEX_APP_SERVER_USE_LOCAL_DAEMON = "1";
      desktopEnv.CODEX_APP_SERVER_WS_URL = teamTransportUrl(relayPort);
      const desktop = spawnImpl(desktopExecutable, [`--remote-debugging-port=${cdpPort}`], {
        detached: true,
        stdio: "ignore",
        env: desktopEnv
      });
      teamDesktopPid = desktop.pid ?? null;
      desktop.unref?.();
    },
    async waitForTeamTransport() {
      await waitForRelayState(paths.relayState, relayPort, 15_000, (state) => state.phase === "ready");
    },
    async verifyTeamTransport() {
      await waitForRelayState(paths.relayState, relayPort, 15_000, (state) => state.activeConnections > 0);
      if (!Number.isInteger(teamDesktopPid) || teamDesktopPid <= 0) {
        throw new Error("Codex Team Desktop process identifier is unavailable");
      }
      const { stdout } = await execFileImpl("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
      if (hasDesktopStdioAppServerSnapshot(stdout, teamDesktopPid, desktopExecutable)) {
        throw new Error("Codex Team Desktop fell back to a private stdio App Server");
      }
    },
    async startRuntime() {
      await unlink(paths.runtimeState).catch(() => undefined);
      const runtime = spawnImpl(process.execPath, [path.join(scriptsRoot, "runtime-process.mjs")], {
        detached: true,
        stdio: "ignore",
        env: {
          ...env,
          CODEX_AGENT_TEAM_CDP_PORT: String(cdpPort),
          CODEX_APP_SERVER_USE_LOCAL_DAEMON: "1",
          CODEX_APP_SERVER_WS_URL: teamTransportUrl(relayPort)
        }
      });
      runtime.unref?.();
      await waitForRuntimeReady(paths.runtimeState, 45_000);
    },
    async stopRuntime() {
      let pid = null;
      try {
        const state = JSON.parse(await readFile(paths.runtimeState, "utf8"));
        if (Number.isInteger(state.pid) && state.pid > 0) pid = state.pid;
      } catch {}
      await sendIpc(paths.runtimeSocket, { type: "stop" }, 1_000).catch(() => undefined);
      if (pid) await waitForDesktopPidsExit([pid], 10_000);
    },
    async clearRuntimeState() {
      await Promise.all([
        unlink(paths.runtimeSocket).catch(() => undefined),
        unlink(paths.runtimeState).catch(() => undefined),
        unlink(`${paths.runtimeState}.lock`).catch(() => undefined),
        unlink(paths.relayState).catch(() => undefined)
      ]);
    },
    async launchNormalDesktop() {
      const desktop = spawnImpl(desktopExecutable, [], {
        detached: true,
        stdio: "ignore",
        env: desktopEnvironment(env)
      });
      desktop.unref?.();
    },
    async persistMode(mode) {
      await mkdir(paths.dataRoot, { recursive: true });
      await writeFile(paths.modeFile, `${JSON.stringify({
        version: 1,
        mode,
        ...(mode === "team" ? { relayPort } : {}),
        scriptsRoot,
        updatedAt: new Date().toISOString()
      }, null, 2)}\n`, { mode: 0o600 });
    },
    async installKeeper() {
      if (env.CODEX_AGENT_TEAM_KEEPER_ACTIVE === "1") return;
      await installModeKeeper({ paths, scriptsRoot, env, execFileImpl });
    },
    async removeKeeper() {
      await removeModeKeeper({ paths, execFileImpl });
    }
  };
}

export async function inspectPersistedMode(paths) {
  try {
    const value = JSON.parse(await readFile(paths.modeFile, "utf8"));
    return value?.mode === "team" ? value : { ...value, mode: "normal" };
  } catch {
    return { version: 1, mode: "normal" };
  }
}

export async function preflightModeTransition({ target, paths, codexCli, desktopExecutable, teamStore }) {
  validateTarget(target);
  await access(desktopExecutable, constants.X_OK);
  await execFileAsync(codexCli, ["--version"], { encoding: "utf8", timeout: 5_000 });
  if (target === "team") {
    await Promise.all([
      mkdir(paths.runRoot, { recursive: true }),
      mkdir(paths.workspaceRoot, { recursive: true }),
      teamStore.read()
    ]);
  }
}

async function installModeKeeper({ paths, scriptsRoot, env, execFileImpl }) {
  const stagingRoot = `${paths.keeperBundleRoot}.next-${process.pid}`;
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  await Promise.all([
    cp(scriptsRoot, path.join(stagingRoot, "scripts"), { recursive: true }),
    cp(path.resolve(scriptsRoot, "..", "assets"), path.join(stagingRoot, "assets"), { recursive: true })
  ]);

  await mkdir(path.dirname(paths.launchAgentFile), { recursive: true });
  const domain = `gui/${process.getuid?.() ?? os.userInfo().uid}`;
  await execFileImpl("launchctl", ["bootout", `${domain}/${paths.launchAgentLabel}`]).catch(() => undefined);
  await rm(paths.keeperBundleRoot, { recursive: true, force: true });
  await rename(stagingRoot, paths.keeperBundleRoot);
  const plist = launchAgentPlist({
    label: paths.launchAgentLabel,
    nodePath: process.execPath,
    keeperPath: path.join(paths.keeperRoot, "mode-keeper.mjs"),
    logPath: paths.modeLog,
    codexHome: paths.codexHome,
    codexCli: env.CODEX_AGENT_TEAM_CODEX_PATH,
    desktopExecutable: env.CODEX_AGENT_TEAM_DESKTOP_PATH
  });
  await writeFile(paths.launchAgentFile, plist, { mode: 0o600 });
  await execFileImpl("launchctl", ["bootstrap", domain, paths.launchAgentFile]);
}

async function removeModeKeeper({ paths, execFileImpl }) {
  const domain = `gui/${process.getuid?.() ?? os.userInfo().uid}`;
  await execFileImpl("launchctl", ["bootout", `${domain}/${paths.launchAgentLabel}`]).catch(() => undefined);
  await unlink(paths.launchAgentFile).catch(() => undefined);
}

function launchAgentPlist({ label, nodePath, keeperPath, logPath, codexHome, codexCli, desktopExecutable }) {
  const environment = [
    ["CODEX_HOME", codexHome],
    ["CODEX_AGENT_TEAM_CODEX_PATH", codexCli],
    ["CODEX_AGENT_TEAM_DESKTOP_PATH", desktopExecutable]
  ].filter((entry) => entry[1]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(keeperPath)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>EnvironmentVariables</key><dict>${environment.map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join("")}</dict>
  <key>StandardOutPath</key><string>${xml(logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict></plist>
`;
}

function desktopEnvironment(env) {
  const result = { ...env };
  delete result.CODEX_CLI_PATH;
  delete result.CODEX_APP_SERVER_FORCE_CLI;
  delete result.CODEX_APP_SERVER_USE_LOCAL_DAEMON;
  delete result.CODEX_APP_SERVER_WS_URL;
  return result;
}

function teamTransportUrl(port) {
  if (!Number.isInteger(port) || port <= 0) throw new Error("Team transport port is unavailable");
  return `ws://127.0.0.1:${port}/rpc`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForRuntimeReady(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    try {
      latest = JSON.parse(await readFile(file, "utf8"));
      if (latest.phase === "ready") return latest;
      if (latest.phase === "failed") throw new Error(latest.error || "Team Runtime failed to start");
    } catch (error) {
      if (error?.code !== "ENOENT" && !error?.message?.includes("Unexpected end")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Team Runtime did not become ready${latest?.error ? `: ${latest.error}` : ""}`);
}

async function waitForRelayState(file, port, timeoutMs, predicate) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    try {
      latest = JSON.parse(await readFile(file, "utf8"));
      if (latest.port === port && predicate(latest)) return latest;
      if (latest.phase === "failed") throw new Error(latest.error || "Team transport failed to start");
    } catch (error) {
      if (error?.code !== "ENOENT" && !error?.message?.includes("Unexpected end")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Team transport did not become ready${latest?.error ? `: ${latest.error}` : ""}`);
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isAlreadyInTarget(current, target) {
  if (target === "team") return current?.mode === "team"
    && current?.runtimeReady === true
    && current?.teamTransportReady === true;
  return current?.mode === "normal"
    && current?.runtimeReady !== true
    && current?.daemonEnvironment !== true;
}

function validateTarget(target) {
  if (!TARGETS.has(target)) throw new Error(`Unsupported Team mode target: ${String(target)}`);
}
