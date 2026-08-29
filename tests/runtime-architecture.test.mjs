import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("one CodexAgentTeam Runtime owns one temporary official App Server without startup persistence", async () => {
  const source = await readFile("plugins/codex-agent-team/scripts/lib/runtime/run.mjs", "utf8");
  const controller = await readFile("plugins/codex-agent-team/scripts/lib/runtime/controller.mjs", "utf8");
  const appServer = await readFile("plugins/codex-agent-team/scripts/lib/runtime/app-server.mjs", "utf8");
  const session = await readFile("plugins/codex-agent-team/scripts/lib/runtime/session.mjs", "utf8");
  const desktop = await readFile("plugins/codex-agent-team/scripts/lib/runtime/desktop/process.mjs", "utf8");
  const paths = await readFile("plugins/codex-agent-team/scripts/lib/paths.mjs", "utf8");
  const runtime = `${source}\n${controller}\n${session}\n${appServer}\n${desktop}\n${paths}`;

  assert.match(appServer, /process-guard\.mjs/);
  assert.match(appServer, /"--codex",\s*codexCli/);
  assert.match(appServer, /"--url",\s*url/);
  assert.match(appServer, /ownership:\s*"agent-team-app-server"/);
  assert.doesNotMatch(runtime, /app-server", "daemon", "stop/);
  assert.match(desktop, /CODEX_APP_SERVER_WS_URL:\s*appServerUrl/);
  assert.doesNotMatch(source, /CODEX_APP_SERVER_USE_LOCAL_DAEMON/);
  assert.match(desktop, /--remote-debugging-port=/);
  assert.match(desktop, /--user-data-dir=/);
  assert.match(source, /waitForChildProcessExit/);
  assert.match(source, /waitForChildProcessExit\(teamDesktop\.child/);
  assert.match(source, /Desktop native quit timed out/);
  assert.doesNotMatch(source, /detached:\s*true/);
  assert.match(controller, /detached:\s*true/);
  assert.doesNotMatch(controller, /--launcher-pid|--original-desktop-pid/);
  assert.doesNotMatch(runtime, /daemon-relay|mode-switcher|runtime-lifecycle/);
  assert.match(appServer, /cleanCodexEnvironment/);
  assert.doesNotMatch(source, /launchctl\s+(?:setenv|unsetenv)/);
  assert.doesNotMatch(runtime, /"unsetenv"/);
  assert.doesNotMatch(paths, /retiredLaunchEnvironmentKeys/);
  assert.doesNotMatch(source, /startControlObserver\(\)/);
  assert.doesNotMatch(source, /captureCodexDesktopHandoff\(|handoffCodexDesktop\(/);
  assert.doesNotMatch(source, /closeCodexDesktopAndWait\(/);
  assert.doesNotMatch(source, /phase:/);
  assert.match(source, /runOnce\(\)/);
  assert.doesNotMatch(runtime, /waitForCodexDesktopLaunch\(/);
  assert.doesNotMatch(runtime, /RunAtLoad|KeepAlive|PathState|bootstrap/);
  assert.doesNotMatch(runtime, /enabledMarker|disabledMarker|state:\s*"armed"/);
  assert.doesNotMatch(source, /for\s*\(;;\)|while\s*\(true\)/);
  assert.doesNotMatch(source, /waitForDesktopPidsExit/);
  assert.doesNotMatch(runtime, /setInterval\(/);
  assert.doesNotMatch(source, /startClientLeaseServer|server\/diagnostics|clients\.sock/);
  assert.match(source, /rm\(paths\.runtimeBundleRoot,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/);
});

test("Team configuration contains no runtime mode or workflow state", async () => {
  const source = await readFile("plugins/codex-agent-team/scripts/lib/manager/store.mjs", "utf8");

  assert.doesNotMatch(source, /setTeamMode/);
  assert.doesNotMatch(source, /leaderId|taskId|taskStatus|completionRate/);
});

test("CodexAgentTeam Manager speaks Team while Codex and Desktop adapters hide Project details", async () => {
  const agentTeam = await readFile("plugins/codex-agent-team/scripts/lib/manager/index.mjs", "utf8");
  const codex = await readFile("plugins/codex-agent-team/scripts/lib/manager/codex-adapter.mjs", "utf8");
  const navigation = await readFile("plugins/codex-agent-team/scripts/lib/runtime/desktop/navigation.mjs", "utf8");
  const teams = await readFile("plugins/codex-agent-team/scripts/lib/runtime/desktop/teams.mjs", "utf8");

  assert.doesNotMatch(agentTeam, /"project\//);
  assert.match(codex, /"project\/create"/);
  assert.match(codex, /"thread\/metadata\/update"/);
  assert.match(teams, /projects\.upsertLocal/);
  assert.match(teams, /projects\.removeLocal/);
  assert.doesNotMatch(`${agentTeam}\n${navigation}`, /localProjects|threadProjectAssignments/);
});
