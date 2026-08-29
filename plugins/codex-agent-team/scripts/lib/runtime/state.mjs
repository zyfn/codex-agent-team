import { readFile } from "node:fs/promises";

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
