import { accessSync, constants, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolvePaths(env = process.env) {
  const codexHome = path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  // CodexAgentTeam owns its metadata and Team directories. Codex owns CODEX_HOME, its
  // conversations, config, and official App Server persistence.
  const dataRoot = path.resolve(
    env.CODEX_AGENT_TEAM_HOME || path.join(os.homedir(), ".codex-agent-team")
  );
  const runRoot = path.join(dataRoot, "run");
  const runtimeBundleRoot = path.join(dataRoot, "runtime");
  const runtimeStagingRoot = path.join(dataRoot, "runtime.next");
  const runtimeState = path.join(runRoot, "runtime.json");
  return {
    codexHome,
    dataRoot,
    runRoot,
    teamsFile: path.join(dataRoot, "teams.json"),
    teamsRoot: path.join(dataRoot, "teams"),
    desktopProfileRoot: path.join(dataRoot, "desktop-profile"),
    runtimeState,
    operationLockFile: path.join(runRoot, "operation.lock"),
    runtimeLockFile: path.join(runRoot, "runtime.lock"),
    runtimeLog: path.join(runRoot, "runtime.log"),
    runtimeBundleRoot,
    runtimeScript: path.join(runtimeBundleRoot, "scripts", "lib", "runtime", "run.mjs"),
    runtimeStagingRoot,
    runtimeStagingScriptsRoot: path.join(runtimeStagingRoot, "scripts")
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

export function isSamePathOrInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

export function resolveNodeExecutable(
  env = process.env,
  {
    bundledNode = "/Applications/Codex.app/Contents/Resources/cua_node/bin/node",
    alternateBundledNode = "/Applications/Codex.app/Contents/Resources/node/bin/node"
  } = {}
) {
  if (env.CODEX_AGENT_TEAM_NODE_PATH) return env.CODEX_AGENT_TEAM_NODE_PATH;
  for (const candidate of [bundledNode, alternateBundledNode]) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  for (const directory of String(env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, "node");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return process.execPath;
}
