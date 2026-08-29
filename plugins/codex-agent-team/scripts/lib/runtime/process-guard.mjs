#!/usr/bin/env node

import { spawn } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
const appServer = spawn(options.codex, [
  ...(options.codexConfig ? ["-c", options.codexConfig] : []),
  "app-server",
  "--listen",
  options.url
], {
  stdio: ["ignore", "ignore", "pipe"],
  env: { ...process.env, CODEX_HOME: options.codexHome }
});
if (!Number.isInteger(appServer.pid) || appServer.pid <= 0) {
  throw new Error("Official Codex App Server process identifier is unavailable");
}
appServer.stderr.pipe(process.stderr);
const exited = childExit(appServer);
let shuttingDown = false;
let desktop = null;
let inputBuffer = "";

process.stdout.write(`${JSON.stringify({ appServerPid: appServer.pid })}\n`);
process.stdin.setEncoding("utf8");
process.stdin.resume();
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  for (;;) {
    const newline = inputBuffer.indexOf("\n");
    if (newline < 0) break;
    const line = inputBuffer.slice(0, newline);
    inputBuffer = inputBuffer.slice(newline + 1);
    try {
      const message = JSON.parse(line);
      if (message?.type === "desktop" && Number.isInteger(message.pid) && message.pid > 0) {
        desktop = { pid: message.pid };
      }
    } catch {}
  }
});
process.stdin.once("end", () => { void shutdown(0); });
process.once("SIGTERM", () => { void shutdown(0); });
process.once("SIGINT", () => { void shutdown(0); });

appServer.once("error", (error) => {
  process.stderr.write(`CodexAgentTeam App Server failed: ${error.message}\n`);
  void shutdown(1);
});
appServer.once("exit", (code, signal) => {
  if (shuttingDown) return;
  void shutdown(code ?? 1, signal);
});

async function shutdown(exitCode, propagateSignal = null) {
  if (shuttingDown) return;
  shuttingDown = true;
  await requestDesktopQuit(desktop?.pid).catch(() => undefined);
  if (Number.isInteger(desktop?.pid) && await waitForProcessGone(desktop.pid, 2_000) === false) {
    try { process.kill(desktop.pid, "SIGTERM"); } catch {}
  }
  await stopChild(appServer, exited, 2_000);
  if (propagateSignal) {
    process.removeAllListeners(propagateSignal);
    process.kill(process.pid, propagateSignal);
    return;
  }
  process.exit(exitCode);
}

function parseArgs(args) {
  const value = (name) => {
    const index = args.indexOf(name);
    const result = index >= 0 ? args[index + 1] : null;
    if (!result) throw new Error(`${name} is required`);
    return result;
  };
  const optional = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] ?? null : null;
  };
  return {
    codex: value("--codex"),
    url: value("--url"),
    codexHome: value("--codex-home"),
    codexConfig: optional("--codex-config")
  };
}

function childExit(child) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function stopChild(child, exitPromise, graceMs) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    Promise.resolve(exitPromise).then(() => true, () => true),
    new Promise((resolve) => setTimeout(() => resolve(false), graceMs))
  ]);
  if (!stopped && child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.resolve(exitPromise).catch(() => undefined);
  }
}

function requestDesktopQuit(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || !processAlive(pid)) return Promise.resolve();
  const source = [
    'ObjC.import("AppKit")',
    `const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid})`,
    "if (app) app.terminate"
  ].join(";");
  return childExit(spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", source], {
    stdio: "ignore"
  })).then(() => undefined);
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

async function waitForProcessGone(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processAlive(pid);
}
