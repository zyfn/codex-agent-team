import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("one CodexAgentTeam run owns one official App Server and never borrows the shared daemon", async () => {
  const runtime = await readFile("plugins/codex-agent-team/scripts/lib/runtime/run.mjs", "utf8");
  const session = await readFile("plugins/codex-agent-team/scripts/lib/runtime/session.mjs", "utf8");
  const official = await readFile("plugins/codex-agent-team/scripts/lib/runtime/app-server.mjs", "utf8");
  const desktop = await readFile("plugins/codex-agent-team/scripts/lib/runtime/desktop/process.mjs", "utf8");
  const guard = await readFile("plugins/codex-agent-team/scripts/lib/runtime/process-guard.mjs", "utf8");
  const messaging = await readFile("plugins/codex-agent-team/scripts/lib/manager/collaboration.mjs", "utf8");
  const command = await readFile("plugins/codex-agent-team/scripts/codex-agent-team.mjs", "utf8");
  const runtimeClient = await readFile("plugins/codex-agent-team/scripts/lib/runtime/app-server.mjs", "utf8");
  const terminal = await readFile("plugins/codex-agent-team/scripts/lib/runtime/terminal.mjs", "utf8");
  const source = `${runtime}\n${session}\n${desktop}\n${messaging}\n${runtimeClient}\n${terminal}`;

  assert.doesNotMatch(source, /connectSharedAppServer|disconnectSharedAppServer|probeSharedAppServer/);
  assert.match(runtime, /startAppServer/);
  assert.match(runtime, /stopAppServer/);
  assert.match(desktop, /CODEX_APP_SERVER_WS_URL:\s*appServerUrl/);
  assert.doesNotMatch(runtime, /CODEX_APP_SERVER_USE_LOCAL_DAEMON/);
  assert.match(official, /ownership:\s*"agent-team-app-server"/);
  assert.match(official, /process-guard\.mjs/);
  assert.match(guard, /process\.stdin\.once\("end"/);
  assert.doesNotMatch(messaging, /runtime\/|connectActiveAppServer/);
  assert.match(command, /connectActiveAppServer/);
  assert.match(runtimeClient, /runtime\.appServerUrl/);
  assert.match(terminal, /runtime\.appServerUrl/);
});
