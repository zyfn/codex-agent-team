import { spawn } from "node:child_process";
import path from "node:path";

import { cleanCodexEnvironment } from "../app-server.mjs";

/** Start a second Codex Desktop with an isolated Electron profile. */
export function startTeamDesktop({
  desktopExecutable,
  profileRoot,
  codexHome,
  appServerUrl,
  cdpPort,
  spawnImpl = spawn
}) {
  if (!desktopExecutable || !profileRoot || !codexHome || !appServerUrl) {
    throw new TypeError("CodexAgentTeam Desktop requires executable, profile, CODEX_HOME, and App Server");
  }
  if (!Number.isInteger(cdpPort) || cdpPort <= 0) {
    throw new TypeError("CodexAgentTeam Desktop requires a valid CDP port");
  }
  const child = spawnImpl(desktopExecutable, [
    `--user-data-dir=${profileRoot}`,
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1"
  ], {
    stdio: "ignore",
    env: {
      ...cleanCodexEnvironment({ CODEX_HOME: codexHome }),
      CODEX_APP_SERVER_WS_URL: appServerUrl
    }
  });
  if (!Number.isInteger(child.pid) || child.pid <= 0) {
    throw new Error("CodexAgentTeam Codex process identifier is unavailable");
  }
  return {
    pid: child.pid,
    child,
    cdpPort,
    exited: waitForChildProcessExit(child)
  };
}

export function requestCodexDesktopQuit({ pid, spawnImpl = spawn } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new TypeError("A live Codex Desktop PID is required for native quit");
  }
  const source = [
    'ObjC.import("AppKit")',
    `const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid})`,
    "if (app) app.terminate"
  ].join(";");
  return runProcess(
    spawnImpl,
    "osascript",
    ["-l", "JavaScript", "-e", source],
    `Codex Desktop PID ${pid} did not accept the native quit request`
  );
}

export async function isUnexpectedDesktopDisconnect({
  desktopExited,
  graceMs = 2_000,
  wait,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
}) {
  if (wait) {
    return Promise.race([
      Promise.resolve(desktopExited).then(() => false).catch(() => false),
      wait(graceMs).then(() => true)
    ]);
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (unexpected) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeoutImpl(timer);
      resolve(unexpected);
    };
    timer = setTimeoutImpl(() => finish(true), graceMs);
    Promise.resolve(desktopExited).then(
      () => finish(false),
      () => finish(false)
    );
  });
}

export function listDesktopStdioAppServerPids({
  desktopPid,
  desktopExecutable = "/Applications/Codex.app/Contents/MacOS/ChatGPT"
} = {}) {
  return readProcessSnapshot().then((output) =>
    parseDesktopStdioAppServerPids(output, { desktopPid, desktopExecutable })
  );
}

export async function stopTeamDesktopHelpers({
  profileRoot,
  readProcesses = readProcessSnapshot,
  signalProcess = process.kill.bind(process),
  isProcessAlive = processAlive,
  wait = delay,
  graceMs = 1_000
}) {
  if (!profileRoot) return [];
  const crashpadRoot = path.join(path.resolve(profileRoot), "Crashpad");
  const pids = parseProcessSnapshot(await readProcesses())
    .filter((entry) => /(?:^|\/)browser_crashpad_handler(?:\s|$)/.test(entry.command))
    .filter((entry) => entry.command.includes(`--database=${crashpadRoot}`))
    .map((entry) => entry.pid)
    .sort((left, right) => left - right);
  const send = (pid, signal) => {
    try {
      signalProcess(pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  };
  for (const pid of pids) {
    if (isProcessAlive(pid)) send(pid, "SIGTERM");
  }
  const deadline = Date.now() + graceMs;
  while (pids.some(isProcessAlive) && Date.now() < deadline) await wait(20);
  for (const pid of pids) {
    if (isProcessAlive(pid)) send(pid, "SIGKILL");
  }
  return pids;
}

export function waitForChildProcessExit(child, {
  timeoutMs,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  if (!child || typeof child.once !== "function") throw new TypeError("A child process is required");
  if (child.exitCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode ?? null });
  }
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      if (timer !== null) clearTimeoutImpl(timer);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
    };
    const onExit = (code, signal) => { cleanup(); resolve({ code, signal }); };
    const onError = (error) => { cleanup(); reject(error); };
    child.once("exit", onExit);
    child.once("error", onError);
    if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
      timer = setTimeoutImpl(() => {
        cleanup();
        reject(new Error(`Codex Desktop did not exit in ${timeoutMs}ms`));
      }, timeoutMs);
    }
  });
}

export function parseDesktopStdioAppServerPids(
  output,
  { desktopPid, desktopExecutable = "/Applications/Codex.app/Contents/MacOS/ChatGPT" } = {}
) {
  if (!Number.isInteger(desktopPid) || desktopPid <= 0) return [];
  const processes = parseProcessSnapshot(output);
  const root = processes.find((entry) => entry.pid === desktopPid);
  if (!root || (root.command !== desktopExecutable && !root.command.startsWith(`${desktopExecutable} `))) {
    return [];
  }
  const descendants = new Set([desktopPid]);
  expandDescendants(processes, descendants);
  return processes
    .filter((entry) => entry.pid !== desktopPid && descendants.has(entry.pid))
    .filter((entry) => /(?:^|\s)app-server(?:\s|$)/.test(entry.command))
    .filter((entry) => !isSharedAppServer(entry.command))
    .map((entry) => entry.pid)
    .sort((left, right) => left - right);
}

function parseProcessSnapshot(output) {
  return String(output)
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }));
}

function expandDescendants(processes, selected) {
  for (;;) {
    let changed = false;
    for (const entry of processes) {
      if (!selected.has(entry.pid) && selected.has(entry.ppid)) {
        selected.add(entry.pid);
        changed = true;
      }
    }
    if (!changed) return;
  }
}

function isSharedAppServer(command) {
  return /(?:^|\s)app-server\s+(?:daemon|proxy)(?:\s|$)/.test(command)
    || /(?:^|\s)--listen\s+unix:\/\/\S*(?:\s|$)/.test(command);
}

function readProcessSnapshot() {
  return new Promise((resolve, reject) => {
    const child = spawn("ps", ["-axo", "pid=,ppid=,command="], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Unable to inspect Codex Desktop process tree (ps ${code})`));
    });
  });
}

function runProcess(spawnImpl, command, args, errorPrefix) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${errorPrefix} (${command} ${code})`));
    });
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
