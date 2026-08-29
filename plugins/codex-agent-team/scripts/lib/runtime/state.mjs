import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function readRuntimeState(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export function runtimeIsLive(runtime, isProcessAlive = processAlive) {
  return Number.isInteger(runtime?.pid) && runtime.pid > 0 && isProcessAlive(runtime.pid);
}

export async function runtimeProcessMatches(runtime, {
  runtimeScript,
  readProcessCommand = processCommand,
} = {}) {
  if (!runtimeIsLive(runtime) || !runtimeScript) return false;
  try {
    const command = await readProcessCommand(runtime.pid);
    return String(command).includes(path.resolve(runtimeScript));
  } catch {
    return false;
  }
}

export async function requireActiveRuntime(file, {
  isProcessAlive
} = {}) {
  const runtime = await readRuntimeState(file);
  if (
    runtime?.state !== "active" ||
    !runtimeIsLive(runtime, isProcessAlive)
  ) {
    throw new Error("CodexAgentTeam is not running. Launch CodexAgentTeam first");
  }
  return runtime;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function processCommand(pid) {
  const { stdout } = await execFileAsync("/bin/ps", [
    "-p", String(pid), "-o", "command=",
  ], { encoding: "utf8", timeout: 2_000, maxBuffer: 64 * 1024 });
  return stdout.trim();
}
