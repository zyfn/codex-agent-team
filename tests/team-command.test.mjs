import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildCliResumeCommand, findTeamMember, formatRuntimeStatus } from "../scripts/lib/team-command.mjs";

test("CLI recovery targets the same native Thread through the official local daemon mode", () => {
  const command = buildCliResumeCommand({
    codexCli: "/Applications/Codex.app/Contents/Resources/codex",
    cwd: "/tmp/商业化团队/后端 service",
    threadId: "01a0-thread",
    websocketUrl: "ws://127.0.0.1:49152/rpc"
  });

  assert.match(command, /^CODEX_APP_SERVER_USE_LOCAL_DAEMON=1 /);
  assert.match(command, /CODEX_APP_SERVER_WS_URL='ws:\/\/127\.0\.0\.1:49152\/rpc'/);
  assert.match(command, /'\/tmp\/商业化团队\/后端 service'/);
  assert.match(command, /resume '01a0-thread'$/);
  assert.doesNotMatch(command, /app-server-control\.sock/);
});

test("CLI recovery resolves a Team and member by either name or id", () => {
  const state = {
    teams: [{
      id: "team-1",
      name: "商业化团队",
      members: [{ id: "member-1", name: "后端", cwd: "/tmp/backend", threadId: "thread-1" }]
    }]
  };

  assert.equal(findTeamMember(state, { team: "商业化团队", member: "member-1" }).member.threadId, "thread-1");
  assert.throws(() => findTeamMember(state, { team: "不存在", member: "后端" }), /Team not found/);
});

test("status output is concise Chinese instead of raw implementation JSON", () => {
  assert.equal(formatRuntimeStatus({ phase: "ready", pid: 123, cdpPort: 9339 }), "团队模式：运行中");
  assert.equal(formatRuntimeStatus({ phase: "off" }), "团队模式：未开启");
  assert.match(formatRuntimeStatus({ phase: "failed", error: "boom" }), /启动失败：boom/);
});

test("team command exposes readable status and diagnostics without raw JSON", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-command-"));
  await mkdir(path.join(codexHome, "codex-agent-team", "run"), { recursive: true });
  await writeFile(path.join(codexHome, "codex-agent-team", "teams.json"), '{"version":2,"revision":0,"teams":[]}\n');
  const env = { ...process.env, CODEX_HOME: codexHome };

  const status = spawnSync(process.execPath, ["scripts/team.mjs", "status"], {
    cwd: path.resolve(import.meta.dirname, ".."), env, encoding: "utf8"
  });
  const diagnose = spawnSync(process.execPath, ["scripts/team.mjs", "diagnose"], {
    cwd: path.resolve(import.meta.dirname, ".."), env, encoding: "utf8"
  });

  assert.equal(status.status, 0);
  assert.equal(status.stdout.trim(), "团队模式：未开启");
  assert.equal(diagnose.status, 0);
  assert.match(diagnose.stdout, /Codex CLI/);
  assert.match(diagnose.stdout, /团队数据/);
  assert.doesNotMatch(diagnose.stdout, /^\s*\{/);
});

test("mode commands finish preflight and wait for explicit user confirmation", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-confirm-"));
  const dataRoot = path.join(codexHome, "codex-agent-team");
  await mkdir(path.join(dataRoot, "run"), { recursive: true });
  await writeFile(path.join(dataRoot, "teams.json"), '{"version":2,"revision":0,"teams":[]}\n');
  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    CODEX_AGENT_TEAM_CODEX_PATH: "/usr/bin/true",
    CODEX_AGENT_TEAM_DESKTOP_PATH: "/usr/bin/true"
  };

  const opening = spawnSync(process.execPath, ["scripts/team.mjs", "open"], {
    cwd: path.resolve(import.meta.dirname, ".."), env, encoding: "utf8"
  });
  assert.equal(opening.status, 0);
  assert.match(opening.stdout, /确认后.*进入团队模式/);

  await writeFile(path.join(dataRoot, "mode.json"), '{"version":1,"mode":"team"}\n');
  const closing = spawnSync(process.execPath, ["scripts/team.mjs", "close"], {
    cwd: path.resolve(import.meta.dirname, ".."), env, encoding: "utf8"
  });
  assert.equal(closing.status, 0);
  assert.match(closing.stdout, /确认后.*恢复普通模式/);
});
