import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("a stale LaunchAgent exits without starting the daemon when Team mode is not persisted", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-keeper-"));
  await mkdir(path.join(codexHome, "codex-agent-team", "run"), { recursive: true });

  try {
    const result = await execFileAsync(process.execPath, [
      path.resolve("scripts/mode-keeper.mjs")
    ], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        CODEX_AGENT_TEAM_CODEX_PATH: "/definitely/must-not-run/codex"
      },
      encoding: "utf8",
      timeout: 3_000
    });

    assert.equal(result.stderr, "");
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});
