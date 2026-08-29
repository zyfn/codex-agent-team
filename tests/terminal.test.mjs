import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCmuxScript,
  buildGhosttyScript,
  createCmuxTerminal,
  createGhosttyTerminal,
  splitPlan,
  createTeamTerminal
} from "../plugins/codex-agent-team/scripts/lib/runtime/terminal.mjs";

test("one Team terminal request resumes every native member Thread through the owned App Server", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-terminal-"));
  const runtimeState = path.join(root, "runtime.json");
  await writeFile(runtimeState, JSON.stringify({
    state: "active",
    appServerUrl: "ws://127.0.0.1:4567/",
    pid: process.pid
  }));
  let opened;
  const launcher = createTeamTerminal({
    manager: {
      async readTeam() {
        return {
          teamId: "team-1",
          name: "商业化团队",
          members: [
            { id: "member-1", name: "Frontend", role: "Own the UI", cwd: "/tmp/front end", threadId: "thread-front" },
            { id: "member-2", name: "Backend", role: "Own the API", cwd: "/tmp/backend", threadId: "thread-back" }
          ]
        };
      }
    },
    paths: {
      runtimeState,
      codexHome: "/tmp/codex-home"
    },
    codexCli: "/Applications/Codex.app/Contents/Resources/codex",
    terminals: {
      ghostty: { async open(layout) { opened = layout; return { terminal: "ghostty" }; } }
    }
  });

  await launcher.open({ teamId: "team-1", terminal: "ghostty" });

  assert.equal(opened.title, "CodexAgentTeam · 商业化团队");
  assert.equal(opened.panes.length, 2);
  assert.doesNotMatch(opened.panes[0].command, /team-cli\.mjs|clients\.sock/);
  assert.match(opened.panes[0].command, /--remote.*ws:\/\/127\.0\.0\.1:4567/);
  assert.match(opened.panes[0].command, /resume.*thread-front/);
  assert.match(opened.panes[0].command, /developer_instructions=/);
  assert.match(opened.panes[0].command, /Own the UI/);
  assert.match(opened.panes[1].command, /resume.*thread-back/);
  await rm(root, { recursive: true, force: true });
});

test("terminal layouts form a compact grid without inventing pane state", () => {
  assert.deepEqual(splitPlan(4), [
    { index: 1, target: 0, direction: "right" },
    { index: 2, target: 0, direction: "down" },
    { index: 3, target: 1, direction: "down" }
  ]);
});

test("terminal applications expose installation state and native app icons without opening them", async () => {
  const launcher = createTeamTerminal({
    manager: null,
    paths: null,
    codexCli: null,
    terminals: {
      ghostty: createGhosttyTerminal({
        async accessFile() {},
        async loadIcon() { return "data:image/png;base64,ghostty"; }
      }),
      cmux: createCmuxTerminal({
        async accessFile() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }
      })
    }
  });
  assert.deepEqual(await launcher.applications(), {
    ghostty: { available: true, icon: "data:image/png;base64,ghostty" },
    cmux: { available: false, icon: null }
  });
});

test("Ghostty uses one native tab with native split commands", async (context) => {
  const layout = {
    id: "team-1",
    title: "CodexAgentTeam · Product",
    panes: [
      { title: "Frontend", cwd: "/tmp/frontend", command: "codex resume front" },
      { title: "Backend", cwd: "/tmp/backend", command: "codex resume back" },
      { title: "QA", cwd: "/tmp/qa", command: "codex resume qa" }
    ]
  };
  const script = buildGhosttyScript(layout);
  assert.match(script, /new tab in teamWindow with configuration config1/);
  assert.match(script, /split terminal1 direction right with configuration config2/);
  assert.match(script, /split terminal1 direction down with configuration config3/);
  assert.match(script, /set_tab_title:CodexAgentTeam · Product/);

  if (process.platform !== "darwin") return;
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-applescript-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const result = spawnSync("/usr/bin/osacompile", [
    "-e", script,
    "-o", path.join(root, "ghostty.scpt")
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("cmux uses its native AppleScript API instead of requiring control-socket access", async () => {
  const calls = [];
  const adapter = createCmuxTerminal({
    async accessFile() {},
    async execFile(file, args) {
      calls.push([file, args]);
      return { stdout: "opened\n" };
    }
  });
  const result = await adapter.open({
    id: "team-1",
    title: "CodexAgentTeam · Product",
    panes: [
      { title: "A", cwd: "/tmp/a", command: "codex resume a" },
      { title: "B", cwd: "/tmp/b", command: "codex resume b" },
      { title: "C", cwd: "/tmp/c", command: "codex resume c" }
    ]
  });

  assert.deepEqual(result, { terminal: "cmux", disposition: "opened" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/usr/bin/osascript");
  assert.equal(calls[0][1][0], "-e");
  assert.match(calls[0][1][1], /tell application "cmux"/);
  assert.match(calls[0][1][1], /split terminal1 direction right/);
  assert.match(calls[0][1][1], /split terminal1 direction down/);
  assert.doesNotMatch(calls[0][1][1], /CMUX_SOCKET_MODE|ping|list-workspaces/);
});

test("cmux AppleScript waits for each terminal and submits the native resume command", async (context) => {
  const script = buildCmuxScript({
    id: "team-1",
    title: "CodexAgentTeam · Product",
    panes: [
      { title: "Frontend", cwd: "/tmp/frontend", command: "codex resume front" },
      { title: "Backend", cwd: "/tmp/backend", command: "codex resume back" }
    ]
  });
  assert.match(script, /rename-workspace.*codex resume front" to terminal1/);
  assert.ok(script.includes('perform action "text:\\\\x0d" on terminal1'));
  assert.match(script, /repeat 50 times/);
  assert.match(script, /select tab teamTab/);
  assert.match(script, /return "opened"/);

  if (process.platform !== "darwin") return;
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-cmux-applescript-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const result = spawnSync("/usr/bin/osacompile", [
    "-e", script,
    "-o", path.join(root, "cmux.scpt")
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
