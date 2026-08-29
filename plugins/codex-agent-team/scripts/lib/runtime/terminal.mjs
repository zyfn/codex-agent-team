import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { buildMemberResumeCommand } from "./diagnostics.mjs";
import { buildMemberInstructions } from "../manager/codex-adapter.mjs";
import { requireActiveRuntime } from "./state.mjs";

const execFileAsync = promisify(execFile);

export function createTeamTerminal({ manager, paths, codexCli, terminals }) {
  return {
    async applications() {
      return Object.fromEntries(await Promise.all(
        Object.entries(terminals).map(async ([name, terminal]) => [
          name,
          typeof terminal.describe === "function"
            ? await terminal.describe()
            : { available: typeof terminal.available === "function" ? await terminal.available() : false, icon: null }
        ])
      ));
    },
    async open({ teamId, terminal }) {
      const team = await manager.readTeam(required(teamId, "Team id"));
      if (!team.members.length) throw new Error(`Team "${team.name}" has no members to open`);
      const runtime = await requireActiveRuntime(paths.runtimeState);
      if (!runtime.appServerUrl) throw new Error("CodexAgentTeam App Server endpoint is unavailable");
      const selected = terminals[required(terminal, "Terminal")];
      if (!selected) throw new Error(`Unsupported terminal: ${terminal}`);
      if (typeof selected.available === "function" && !(await selected.available())) {
        throw new Error(`${terminal} is not installed`);
      }
      const layout = {
        id: team.teamId,
        title: `CodexAgentTeam · ${team.name}`,
        panes: team.members.map((member) => ({
          id: member.threadId,
          title: member.name,
          cwd: member.cwd,
          command: terminalCommand({
            title: member.name,
            resumeCommand: buildMemberResumeCommand({
              codexCli,
              codexHome: paths.codexHome,
              cwd: member.cwd,
              threadId: member.threadId,
              remoteUrl: runtime.appServerUrl,
              developerInstructions: buildMemberInstructions(member),
            })
          })
        }))
      };
      return selected.open(layout);
    }
  };
}

export function createGhosttyTerminal({
  execFile: run = execFileAsync,
  osascript = "/usr/bin/osascript",
  ghosttyApp = "/Applications/Ghostty.app",
  iconFile = path.join(ghosttyApp, "Contents/Resources/Ghostty.icns"),
  loadIcon = loadApplicationIconDataUrl,
  accessFile = access
} = {}) {
  async function available() {
    try {
      await accessFile(ghosttyApp);
      return true;
    } catch {
      return false;
    }
  }
  return {
    available,
    async describe() {
      const installed = await available();
      return {
        available: installed,
        icon: installed ? await loadIcon(iconFile).catch(() => null) : null
      };
    },
    async open(layout) {
      const { stdout } = await run(osascript, ["-e", buildGhosttyScript(layout)], {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 1024 * 1024
      });
      return { terminal: "ghostty", disposition: String(stdout).trim() || "opened" };
    }
  };
}

export function createCmuxTerminal({
  execFile: run = execFileAsync,
  osascript = "/usr/bin/osascript",
  cmuxApp = "/Applications/cmux.app",
  cmuxCli = path.join(cmuxApp, "Contents/Resources/bin/cmux"),
  iconFile = path.join(cmuxApp, "Contents/Resources/AppIcon.icns"),
  loadIcon = loadApplicationIconDataUrl,
  accessFile = access
} = {}) {
  async function available() {
    try {
      await accessFile(cmuxApp);
      return true;
    } catch {
      return false;
    }
  }

  return {
    available,
    async describe() {
      const installed = await available();
      return {
        available: installed,
        icon: installed ? await loadIcon(iconFile).catch(() => null) : null
      };
    },
    async open(layout) {
      const { stdout } = await run(osascript, ["-e", buildCmuxScript(layout, { cmuxCli })], {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 1024 * 1024
      });
      return { terminal: "cmux", disposition: String(stdout).trim() || "opened" };
    }
  };
}

export function buildCmuxScript(layout, {
  cmuxCli = "/Applications/cmux.app/Contents/Resources/bin/cmux"
} = {}) {
  const lines = [
    'tell application "cmux"',
    "  activate",
    "  repeat with candidateWindow in windows",
    "    repeat with candidateTab in tabs of candidateWindow",
    `      if name of candidateTab is ${appleScriptString(layout.title)} then`,
    "        select tab candidateTab",
    "        activate window candidateWindow",
    '        return "focused"',
    "      end if",
    "    end repeat",
    "  end repeat",
    "  if (count of windows) is 0 then",
    "    set teamWindow to new window",
    "    set teamTab to selected tab of teamWindow",
    "  else",
    "    set teamWindow to front window",
    "    set teamTab to new tab in teamWindow",
    "  end if",
    "  select tab teamTab",
    "  set terminal1 to focused terminal of teamTab"
  ];
  for (const step of splitPlan(layout.panes.length)) {
    lines.push(`  set terminal${step.index + 1} to split terminal${step.target + 1} direction ${step.direction}`);
  }
  for (const [index, pane] of layout.panes.entries()) {
    const terminal = index + 1;
    const command = index === 0
      ? `${shellQuote(cmuxCli)} rename-workspace -- ${shellQuote(layout.title)} >/dev/null 2>&1; exec ${pane.command}`
      : pane.command;
    lines.push(
      `  input text ${appleScriptString(command)} to terminal${terminal}`,
      `  set submitted${terminal} to false`,
      "  repeat 50 times",
      "    delay 0.1",
      `    if perform action "text:\\\\x0d" on terminal${terminal} then`,
      `      set submitted${terminal} to true`,
      "      exit repeat",
      "    end if",
      "  end repeat",
      `  if submitted${terminal} is false then error ${appleScriptString(`cmux terminal ${terminal} did not become ready`)}`
    );
  }
  lines.push(
    "  activate window teamWindow",
    '  return "opened"',
    "end tell"
  );
  return lines.join("\n");
}

export function buildGhosttyScript(layout) {
  const lines = [
    'tell application "Ghostty"',
    "  activate",
    "  repeat with candidateWindow in windows",
    "    repeat with candidateTab in tabs of candidateWindow",
    `      if name of candidateTab is ${appleScriptString(layout.title)} then`,
    "        select tab candidateTab",
    "        activate window candidateWindow",
    '        return "focused"',
    "      end if",
    "    end repeat",
    "  end repeat"
  ];
  for (const [index, pane] of layout.panes.entries()) {
    lines.push(
      `  set config${index + 1} to new surface configuration from {initial working directory:${appleScriptString(pane.cwd)}, command:${appleScriptString(pane.command)}, wait after command:true}`
    );
  }
  lines.push(
    "  if (count of windows) is 0 then",
    "    set teamWindow to new window with configuration config1",
    "    set teamTab to selected tab of teamWindow",
    "  else",
    "    set teamWindow to front window",
    "    set teamTab to new tab in teamWindow with configuration config1",
    "  end if",
    "  set terminal1 to focused terminal of teamTab",
    `  perform action ${appleScriptString(`set_tab_title:${layout.title}`)} on terminal1`,
    `  perform action ${appleScriptString(`set_surface_title:${layout.panes[0].title}`)} on terminal1`
  );
  for (const step of splitPlan(layout.panes.length)) {
    const terminal = step.index + 1;
    lines.push(
      `  set terminal${terminal} to split terminal${step.target + 1} direction ${step.direction} with configuration config${terminal}`,
      `  perform action ${appleScriptString(`set_surface_title:${layout.panes[step.index].title}`)} on terminal${terminal}`
    );
  }
  lines.push(
    '  perform action "equalize_splits" on terminal1',
    "  activate window teamWindow",
    '  return "opened"',
    "end tell"
  );
  return lines.join("\n");
}

export function splitPlan(count) {
  const total = Number(count);
  if (!Number.isInteger(total) || total < 1) return [];
  const columns = Math.ceil(Math.sqrt(total));
  const lastByColumn = [0];
  const result = [];
  for (let index = 1; index < total; index += 1) {
    if (index < columns) {
      result.push({ index, target: index - 1, direction: "right" });
      lastByColumn[index] = index;
    } else {
      const column = (index - columns) % columns;
      result.push({ index, target: lastByColumn[column], direction: "down" });
      lastByColumn[column] = index;
    }
  }
  return result;
}

function terminalCommand({ title, resumeCommand }) {
  const body = `printf '\\033]0;%s\\007' ${shellQuote(title)}; exec ${resumeCommand}`;
  return `/bin/zsh -lc ${shellQuote(body)}`;
}

export async function loadApplicationIconDataUrl(iconFile, {
  execFile: run = execFileAsync,
  sips = "/usr/bin/sips"
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-icon-"));
  const output = path.join(directory, "icon.png");
  try {
    await run(sips, ["-s", "format", "png", iconFile, "--out", output], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    const bytes = await readFile(output);
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replace(/[\r\n]+/g, " ")}"`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}
