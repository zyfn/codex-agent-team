import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildMemberResumeCommand,
  formatRuntimeStatus,
  readCodexDesktopVersion
} from "../plugins/codex-agent-team/scripts/lib/runtime/diagnostics.mjs";

test("Desktop version diagnostics read the app bundle instead of relabeling the bundled CLI", async () => {
  const calls = [];
  const version = await readCodexDesktopVersion("/Applications/Codex.app/Contents/MacOS/Codex", {
    platform: "darwin",
    async execFileImpl(file, args) {
      calls.push([file, args]);
      return { stdout: "26.814.41407\n" };
    }
  });

  assert.equal(version, "26.814.41407");
  assert.deepEqual(calls, [[
    "/usr/bin/defaults",
    ["read", "/Applications/Codex.app/Contents/Info.plist", "CFBundleShortVersionString"]
  ]]);
});

test("CLI recovery targets the same native Thread through the official remote App Server", () => {
  const command = buildMemberResumeCommand({
    codexCli: "/Applications/Codex.app/Contents/Resources/codex",
    codexHome: "/tmp/codex-home",
    cwd: "/tmp/商业化团队/后端 service",
    threadId: "01a0-thread",
    remoteUrl: "unix://",
    developerInstructions: "You are Backend.\nUse the Team contract.",
  });

  assert.match(command, /^env CODEX_HOME='\/tmp\/codex-home' '.*codex' -c /);
  assert.match(command, /developer_instructions=/);
  assert.match(command, /You are Backend/);
  assert.match(command, /--remote 'unix:\/\/'/);
  assert.match(command, /'\/tmp\/商业化团队\/后端 service'/);
  assert.match(command, /resume '01a0-thread'$/);
  assert.doesNotMatch(command, /app-server-control\.sock/);
});

test("status output is concise English instead of raw implementation JSON", () => {
  assert.equal(formatRuntimeStatus({ state: "active", pid: 123, cdpPort: 9339 }), "CodexAgentTeam: running and connected");
  assert.equal(formatRuntimeStatus({ state: "opening", step: "waiting-for-command" }), "CodexAgentTeam: launching");
  assert.equal(formatRuntimeStatus({ state: "off" }), "CodexAgentTeam: off");
  assert.match(formatRuntimeStatus({ state: "failed", error: "boom" }), /needs attention: boom/);
});

test("team command exposes readable status and diagnostics without raw JSON", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-command-"));
  const dataRoot = path.join(codexHome, "agent-team-home");
  await mkdir(path.join(dataRoot, "run"), { recursive: true });
  await writeFile(path.join(dataRoot, "teams.json"), teamState());
  const env = { ...process.env, CODEX_HOME: codexHome, CODEX_AGENT_TEAM_HOME: dataRoot };

  const status = spawnSync(process.execPath, ["plugins/codex-agent-team/scripts/codex-agent-team.mjs", "status"], {
    cwd: path.resolve(import.meta.dirname, ".."), env, encoding: "utf8"
  });
  const diagnose = spawnSync(process.execPath, ["plugins/codex-agent-team/scripts/codex-agent-team.mjs", "diagnose"], {
    cwd: path.resolve(import.meta.dirname, ".."), env, encoding: "utf8"
  });

  assert.equal(status.status, 0);
  assert.match(status.stdout.trim(), /^CodexAgentTeam:/);
  assert.doesNotMatch(status.stdout, /^\s*\{/);
  assert.equal(diagnose.status, 0);
  assert.match(diagnose.stdout, /Codex CLI/);
  assert.match(diagnose.stdout, /Team data/);
  assert.doesNotMatch(diagnose.stdout, /^\s*\{/);
});

function teamState() {
  return `${JSON.stringify({
    version: 1,
    teams: []
  })}\n`;
}
