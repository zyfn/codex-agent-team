import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildGhosttyScript,
  createCmuxTerminal,
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

test("cmux creates one named workspace and one native split per remaining member", async () => {
  const calls = [];
  const replies = [
    { stdout: "pong\n" },
    { stdout: "" },
    { stdout: "workspace:2 00000000-0000-0000-0000-000000000002\n" },
    { stdout: "surface:3 00000000-0000-0000-0000-000000000003\n" },
    { stdout: "surface:4\n" },
    { stdout: "" },
    { stdout: "" },
    { stdout: "surface:5\n" },
    { stdout: "" },
    { stdout: "" },
    { stdout: "" }
  ];
  const adapter = createCmuxTerminal({
    cmux: process.execPath,
    async execFile(file, args) {
      calls.push([file, args]);
      return replies.shift() ?? { stdout: "" };
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

  assert.equal(result.workspace, "workspace:2");
  assert.equal(calls.filter(([, args]) => args.includes("new-split")).length, 2);
  assert.deepEqual(calls.filter(([, args]) => args[0] === "send-key").map(([, args]) => args.at(-1)), ["enter", "enter"]);
});
