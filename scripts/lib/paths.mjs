import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolvePaths(env = process.env) {
  const codexHome = path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const dataRoot = path.join(codexHome, "codex-agent-team");
  const runRoot = path.join(dataRoot, "run");
  const keeperBundleRoot = path.join(dataRoot, "mode-runtime");
  return {
    codexHome,
    dataRoot,
    runRoot,
    teamsFile: path.join(dataRoot, "teams.json"),
    workspaceRoot: path.join(dataRoot, "workspaces"),
    runtimeSocket: path.join(runRoot, "runtime.sock"),
    runtimeState: path.join(runRoot, "runtime.json"),
    runtimeLog: path.join(runRoot, "runtime.log"),
    relayState: path.join(runRoot, "relay.json"),
    modeFile: path.join(dataRoot, "mode.json"),
    modeLog: path.join(runRoot, "mode.log"),
    keeperBundleRoot,
    keeperRoot: path.join(keeperBundleRoot, "scripts"),
    builtInAssetsRoot: path.join(keeperBundleRoot, "assets"),
    launchAgentLabel: "com.codex-agent-team.mode-keeper",
    launchAgentFile: path.join(os.homedir(), "Library", "LaunchAgents", "com.codex-agent-team.mode-keeper.plist"),
    daemonSocket: path.join(codexHome, "app-server-control", "app-server-control.sock")
  };
}

export function resolveCodexCli(env = process.env) {
  if (env.CODEX_AGENT_TEAM_CODEX_PATH) return env.CODEX_AGENT_TEAM_CODEX_PATH;
  const bundled = "/Applications/Codex.app/Contents/Resources/codex";
  return existsSync(bundled) ? bundled : "codex";
}

export function resolveDesktopExecutable(env = process.env) {
  return env.CODEX_AGENT_TEAM_DESKTOP_PATH || "/Applications/Codex.app/Contents/MacOS/ChatGPT";
}
