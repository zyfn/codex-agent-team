import { access } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { buildMemberResumeCommand } from "./diagnostics.mjs";
import { buildMemberInstructions } from "../manager/codex-adapter.mjs";
import { requireActiveRuntime } from "./state.mjs";

const execFileAsync = promisify(execFile);

export function createTeamTerminal({ manager, paths, codexCli, terminals }) {
  return {
    async availability() {
      return Object.fromEntries(await Promise.all(
        Object.entries(terminals).map(async ([name, terminal]) => [
          name,
          typeof terminal.available === "function" ? await terminal.available() : false
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
  accessFile = access
} = {}) {
  return {
    async available() {
      try {
        await accessFile(ghosttyApp);
        return true;
      } catch {
        return false;
      }
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
  cmux = null,
  open = "/usr/bin/open",
  delay: wait = delay,
  env = process.env,
  accessFile = access
} = {}) {
  cmux ??= resolveCmuxExecutable(env);
  async function command(args) {
    return run(cmux, args, {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
  }

  async function ensureRunning() {
    try {
      await accessFile(cmux, constants.X_OK);
    } catch {
      throw new Error("cmux is not installed or is not available on PATH");
    }
    let accessError = null;
    try {
      await command(["ping"]);
      return;
    } catch (error) {
      accessError = error;
    }
    try {
      await run(open, ["-a", "cmux"], { timeout: 5_000 });
    } catch (error) {
      if (isCmuxAccessDenied(error) || isCmuxAccessDenied(accessError)) throw cmuxAccessError(error ?? accessError);
      throw error;
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await wait(100);
      try {
        await command(["ping"]);
        return;
      } catch (error) {
        if (isCmuxAccessDenied(error)) throw cmuxAccessError(error);
      }
    }
    if (isCmuxAccessDenied(accessError)) throw cmuxAccessError(accessError);
    throw new Error("cmux did not become ready");
  }

  async function findWorkspace(title) {
    const { stdout } = await command(["--id-format", "both", "list-workspaces"]);
    const line = String(stdout).split("\n").find((candidate) => candidate.includes(title));
    return line ? reference(line, "workspace") : null;
  }

  return {
    async available() {
      try {
        await accessFile(cmux, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    async open(layout) {
      await ensureRunning();
      const existing = await findWorkspace(layout.title);
      if (existing) {
        await command(["select-workspace", "--workspace", existing]);
        return { terminal: "cmux", disposition: "focused", workspace: existing };
      }

      const first = layout.panes[0];
      const created = await command([
        "--id-format", "both", "new-workspace",
        "--name", layout.title,
        "--description", `CodexAgentTeam ${layout.id}`,
        "--cwd", first.cwd,
        "--command", first.command
      ]);
      const workspace = reference(created.stdout, "workspace");
      if (!workspace) throw new Error("cmux did not return the created workspace identifier");
      const tree = await command(["--id-format", "both", "tree", "--workspace", workspace]);
      const firstSurface = reference(tree.stdout, "surface");
      if (!firstSurface) throw new Error("cmux did not expose the first terminal surface");
      const surfaces = [firstSurface];
      for (const step of splitPlan(layout.panes.length)) {
        const result = await command([
          "--id-format", "both", "new-split", step.direction,
          "--workspace", workspace,
          "--surface", surfaces[step.target]
        ]);
        const surface = reference(result.stdout, "surface");
        if (!surface) throw new Error("cmux did not return the created terminal surface");
        surfaces.push(surface);
        const pane = layout.panes[step.index];
        await command(["send", "--workspace", workspace, "--surface", surface, pane.command]);
        await command(["send-key", "--workspace", workspace, "--surface", surface, "enter"]);
      }
      await command(["select-workspace", "--workspace", workspace]);
      return { terminal: "cmux", disposition: "opened", workspace };
    }
  };
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

export function resolveCmuxExecutable(env = process.env) {
  if (env.CODEX_AGENT_TEAM_CMUX_PATH) return env.CODEX_AGENT_TEAM_CMUX_PATH;
  const pathCandidates = String(env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, "cmux"));
  const candidates = [
    ...pathCandidates,
    "/Applications/cmux.app/Contents/Resources/bin/cmux",
    "/opt/homebrew/bin/cmux",
    "/usr/local/bin/cmux"
  ];
  return candidates.find((candidate) => isExecutable(candidate))
    ?? "/Applications/cmux.app/Contents/Resources/bin/cmux";
}

function isExecutable(file) {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isCmuxAccessDenied(error) {
  return /access denied|only processes started inside cmux can connect/i.test(errorText(error));
}

function cmuxAccessError(cause) {
  return new Error(
    "cmux control access is restricted; start cmux with CMUX_SOCKET_MODE=allowAll, then retry",
    { cause }
  );
}

function errorText(error) {
  return [error?.message, error?.stderr, error?.stdout].filter(Boolean).join(" ");
}

function reference(value, kind) {
  return String(value ?? "").match(new RegExp(`\\b${kind}:\\d+\\b`))?.[0] ?? null;
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
