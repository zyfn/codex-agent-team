import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("closing the Runtime control pipe stops both guardian and owned App Server", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-guard-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fakeCodex = path.join(root, "fake-codex");
  await writeFile(fakeCodex, [
    "#!/bin/sh",
    "trap 'exit 0' TERM INT",
    "while true; do sleep 1; done"
  ].join("\n"), { mode: 0o755 });

  const guardian = spawn(process.execPath, [
    "plugins/codex-agent-team/scripts/lib/runtime/process-guard.mjs",
    "--codex", fakeCodex,
    "--url", "ws://127.0.0.1:4567",
    "--codex-home", root
  ], { stdio: ["pipe", "pipe", "pipe"] });
  context.after(() => {
    if (guardian.exitCode === null) guardian.kill("SIGKILL");
  });
  const ready = await readJsonLine(guardian.stdout);
  assert.equal(Number.isInteger(ready.appServerPid), true);
  assert.equal(processAlive(ready.appServerPid), true);

  guardian.stdin.end();
  await waitForExit(guardian, 3_000);
  await waitForProcessGone(ready.appServerPid, 3_000);
  assert.equal(processAlive(ready.appServerPid), false);
});

function readJsonLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try { finish(JSON.parse(buffer.slice(0, newline))); }
      catch (error) { finish(null, error); }
    });
    stream.once("error", (error) => finish(null, error));
    stream.once("close", () => finish(null, new Error("guardian closed before ready")));
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("guardian did not exit")), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

async function waitForProcessGone(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}
