import assert from "node:assert/strict";
import test from "node:test";

import { startTeamDesktop } from "../plugins/codex-agent-team/scripts/lib/runtime/desktop/process.mjs";

test("CodexAgentTeam Desktop uses an isolated Electron profile and the owned official App Server", () => {
  const calls = [];
  const child = {
    pid: 8100,
    exitCode: 0,
    signalCode: null,
    once() {}
  };
  const desktop = startTeamDesktop({
    desktopExecutable: "/Applications/Codex.app/Contents/MacOS/ChatGPT",
    profileRoot: "/tmp/agent-team/desktop-profile",
    codexHome: "/tmp/codex-home",
    appServerUrl: "ws://127.0.0.1:4555",
    cdpPort: 9229,
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return child;
    }
  });

  assert.equal(desktop.pid, 8100);
  assert.deepEqual(calls[0].args, [
    "--user-data-dir=/tmp/agent-team/desktop-profile",
    "--remote-debugging-port=9229",
    "--remote-debugging-address=127.0.0.1"
  ]);
  assert.equal(calls[0].options.env.CODEX_HOME, "/tmp/codex-home");
  assert.equal(calls[0].options.env.CODEX_APP_SERVER_WS_URL, "ws://127.0.0.1:4555");
});
