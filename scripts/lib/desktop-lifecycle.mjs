import { spawn } from "node:child_process";

export async function configureCodexDesktopTeamTransport(websocketUrl, { spawnImpl = spawn } = {}) {
  const url = localWebSocketUrl(websocketUrl);
  await runProcess(spawnImpl, "launchctl", ["setenv", "CODEX_APP_SERVER_USE_LOCAL_DAEMON", "1"],
    "Unable to configure Codex Desktop local daemon mode");
  try {
    await runProcess(spawnImpl, "launchctl", ["setenv", "CODEX_APP_SERVER_WS_URL", url],
      "Unable to configure Codex Desktop Team transport");
  } catch (error) {
    await runProcess(spawnImpl, "launchctl", ["unsetenv", "CODEX_APP_SERVER_USE_LOCAL_DAEMON"],
      "Unable to roll back Codex Desktop local daemon mode").catch(() => undefined);
    throw error;
  }
}

export async function restoreCodexDesktopStdioMode({ spawnImpl = spawn } = {}) {
  const errors = [];
  for (const [key, message] of [
    ["CODEX_APP_SERVER_WS_URL", "Unable to remove Codex Desktop Team transport"],
    ["CODEX_APP_SERVER_USE_LOCAL_DAEMON", "Unable to restore Codex Desktop stdio mode"]
  ]) {
    await runProcess(spawnImpl, "launchctl", ["unsetenv", key], message)
      .catch((error) => errors.push(error));
  }
  if (errors.length) throw new AggregateError(errors, "Unable to restore Codex Desktop stdio mode");
}

export function isCodexDesktopPinnedToLocalDaemon({ spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl("launchctl", ["getenv", "CODEX_APP_SERVER_USE_LOCAL_DAEMON"], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code === 0 && output.trim() === "1"));
  });
}

export function requestCodexDesktopQuit({ spawnImpl = spawn } = {}) {
  return runProcess(
    spawnImpl,
    "osascript",
    ["-e", 'tell application id "com.openai.codex" to quit'],
    "Codex Desktop did not accept the native quit request"
  );
}

export function listCodexDesktopPids() {
  return new Promise((resolve, reject) => {
    const child = spawn("pgrep", ["-x", "ChatGPT"], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(`Unable to inspect Codex Desktop processes (pgrep ${code})`));
        return;
      }
      resolve(parseDesktopPids(output));
    });
  });
}

export function listCodexDesktopProcessTreePids({
  desktopExecutable = "/Applications/Codex.app/Contents/MacOS/ChatGPT",
  excludePids = [process.pid]
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("ps", ["-axo", "pid=,ppid=,command="], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Unable to inspect Codex Desktop process tree (ps ${code})`));
        return;
      }
      resolve(parseDesktopProcessTreePids(output, { desktopExecutable, excludePids }));
    });
  });
}

export function isCodexTeamDesktopRunning({
  desktopExecutable = "/Applications/Codex.app/Contents/MacOS/ChatGPT",
  spawnImpl = spawn
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl("ps", ["-axo", "pid=,command="], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Unable to inspect Codex Desktop launch mode (ps ${code})`));
        return;
      }
      resolve(isTeamDesktopProcessSnapshot(output, desktopExecutable));
    });
  });
}

export function isTeamDesktopProcessSnapshot(
  output,
  desktopExecutable = "/Applications/Codex.app/Contents/MacOS/ChatGPT"
) {
  return String(output).split("\n").some((line) => {
    const command = line.replace(/^\s*\d+\s+/, "");
    return (command === desktopExecutable || command.startsWith(`${desktopExecutable} `))
      && /(?:^|\s)--remote-debugging-port=\d+(?:\s|$)/.test(command);
  });
}

export function parseDesktopProcessTreePids(
  output,
  {
    desktopExecutable = "/Applications/Codex.app/Contents/MacOS/ChatGPT",
    excludePids = []
  } = {}
) {
  const processes = String(output)
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }));
  const excluded = new Set(excludePids);
  const selected = new Set(processes
    .filter((entry) => entry.command === desktopExecutable || entry.command.startsWith(`${desktopExecutable} `))
    .map((entry) => entry.pid));

  for (;;) {
    let changed = false;
    for (const entry of processes) {
      if (!selected.has(entry.pid) && selected.has(entry.ppid)) {
        selected.add(entry.pid);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return [...selected]
    .filter((pid) => Number.isInteger(pid) && pid > 0 && !excluded.has(pid))
    .sort((left, right) => left - right);
}

export function hasDesktopStdioAppServerSnapshot(
  output,
  desktopPid,
  desktopExecutable = "/Applications/Codex.app/Contents/MacOS/ChatGPT"
) {
  if (!Number.isInteger(desktopPid) || desktopPid <= 0) return false;
  const processes = parseProcessSnapshot(output);
  const desktop = processes.find((entry) => entry.pid === desktopPid);
  if (!desktop || (desktop.command !== desktopExecutable && !desktop.command.startsWith(`${desktopExecutable} `))) {
    return false;
  }
  const descendants = new Set([desktopPid]);
  for (;;) {
    let changed = false;
    for (const entry of processes) {
      if (!descendants.has(entry.pid) && descendants.has(entry.ppid)) {
        descendants.add(entry.pid);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return processes.some((entry) => entry.pid !== desktopPid
    && descendants.has(entry.pid)
    && /(?:^|\s)app-server(?:\s|$)/.test(entry.command)
    && !/(?:^|\s)app-server\s+daemon(?:\s|$)/.test(entry.command));
}

export function parseDesktopPids(output) {
  return String(output)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

export async function waitForDesktopPidsExit(
  pids,
  timeoutMs,
  isAlive = defaultIsAlive,
  pollMs = 100
) {
  const targets = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = await Promise.all(targets.map((pid) => isAlive(pid)));
    if (states.every((alive) => !alive)) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Previous Codex Desktop process did not exit in time (${targets.join(", ")})`);
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function parseProcessSnapshot(output) {
  return String(output)
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }));
}

function localWebSocketUrl(value) {
  let url;
  try { url = new URL(String(value)); }
  catch { throw new TypeError("Team transport URL must be a valid WebSocket URL"); }
  if (url.protocol !== "ws:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new TypeError("Team transport URL must use ws:// on localhost");
  }
  return url.toString();
}

function runProcess(spawnImpl, command, args, errorPrefix) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${errorPrefix} (${command} ${code})`));
    });
  });
}
