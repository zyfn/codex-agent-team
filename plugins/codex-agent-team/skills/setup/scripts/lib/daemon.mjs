import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function ensureDefaultDaemon(codexCli, {
  codexHome,
  socketPath,
  execFileImpl = execFileAsync,
  pathExistsImpl = pathExists
} = {}) {
  const start = async () => {
    const { stdout } = await execFileImpl(codexCli, ["app-server", "daemon", "start"], daemonCommandOptions(codexHome, 20_000));
    const result = JSON.parse(stdout.trim());
    if (!result.socketPath || !result.appServerVersion) {
      throw new Error("Codex daemon start returned an incomplete response");
    }
    return result;
  };

  let result = await start();
  const activeSocket = socketPath || result.socketPath;
  if (await daemonWorkingDirectoryIsMissing(activeSocket, { execFileImpl, pathExistsImpl })) {
    await stopDefaultDaemon(codexCli, {
      socketPath: activeSocket,
      codexHome,
      execFileImpl,
      socketExistsImpl: pathExistsImpl
    });
    result = await start();
  }
  return result;
}

export async function readDaemonVersion(codexCli, { codexHome, execFileImpl = execFileAsync } = {}) {
  const { stdout } = await execFileImpl(codexCli, ["app-server", "daemon", "version"], daemonCommandOptions(codexHome, 5_000));
  return JSON.parse(stdout.trim());
}

export async function stopDefaultDaemon(codexCli, {
  socketPath,
  codexHome,
  execFileImpl = execFileAsync,
  killImpl = process.kill,
  socketExistsImpl = pathExists,
  waitForExitImpl = waitForProcessExit
} = {}) {
  try {
    await execFileImpl(codexCli, ["app-server", "daemon", "stop"], daemonCommandOptions(codexHome, 30_000));
    return;
  } catch (error) {
    const text = errorText(error);
    if (socketPath && /No such file or directory|os error 2/i.test(text)
      && !await socketExistsImpl(socketPath)) return;
    if (!/running but is not managed by codex app-server daemon/i.test(text)) throw error;
  }

  if (!socketPath) throw new Error("Cannot safely stop an unmanaged daemon without its socket path");
  const { stdout: ownerOutput } = await execFileImpl(
    "lsof",
    ["-nP", "-t", "--", socketPath],
    { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024 }
  );
  const ownerPids = [...new Set(String(ownerOutput).split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 1))];
  if (ownerPids.length !== 1) {
    throw new Error(`Refusing to stop unmanaged daemon: expected one socket owner, found ${ownerPids.length}`);
  }

  const pid = ownerPids[0];
  const { stdout: commandOutput } = await execFileImpl(
    "ps",
    ["-p", String(pid), "-o", "command="],
    { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024 }
  );
  const command = String(commandOutput).trim();
  if (!/(?:^|\/)codex\s+app-server\s+--listen(?:=|\s+)unix:\/\/(?:\s|$)/.test(command)) {
    throw new Error(`Refusing to stop unmanaged daemon PID ${pid}: unexpected command`);
  }

  try {
    killImpl(pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
    return;
  }
  await waitForExitImpl(pid, { killImpl });
}

async function daemonWorkingDirectoryIsMissing(socketPath, { execFileImpl, pathExistsImpl }) {
  if (!socketPath || !await pathExistsImpl(socketPath)) return false;
  try {
    const { stdout: ownerOutput } = await execFileImpl(
      "lsof",
      ["-nP", "-t", "--", socketPath],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024 }
    );
    const ownerPids = [...new Set(String(ownerOutput).split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 1))];
    if (ownerPids.length !== 1) return false;
    const { stdout: cwdOutput } = await execFileImpl(
      "lsof",
      ["-a", "-p", String(ownerPids[0]), "-d", "cwd", "-Fn"],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024 }
    );
    const cwd = String(cwdOutput).split("\n").find((line) => line.startsWith("n"))?.slice(1);
    return Boolean(cwd) && !await pathExistsImpl(cwd);
  } catch {
    return false;
  }
}

function daemonCommandOptions(codexHome, timeout) {
  return {
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024,
    ...(codexHome ? { cwd: codexHome } : {})
  };
}

async function waitForProcessExit(pid, { killImpl = process.kill, timeoutMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      killImpl(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      if (error?.code !== "EPERM") throw error;
    }
    await delay(100);
  }
  throw new Error(`Unmanaged Codex daemon PID ${pid} did not exit after SIGTERM`);
}

function errorText(error) {
  return [error?.message, error?.stderr, error?.stdout].filter(Boolean).join("\n");
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
