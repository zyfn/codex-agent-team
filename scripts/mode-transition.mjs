#!/usr/bin/env node
import { appendFile, mkdir } from "node:fs/promises";

import { listCodexDesktopProcessTreePids } from "./lib/desktop-lifecycle.mjs";
import {
  createSystemModeLifecycle,
  inspectPersistedMode,
  recoverFailedModeTransition,
  runModeTransition
} from "./lib/team-mode-manager.mjs";
import { resolveCodexCli, resolveDesktopExecutable, resolvePaths } from "./lib/paths.mjs";

const target = process.argv[2];
const paths = resolvePaths();
const scriptsRoot = process.env.CODEX_AGENT_TEAM_SCRIPTS_ROOT || import.meta.dirname;
const lifecycle = createSystemModeLifecycle({
  paths,
  codexCli: resolveCodexCli(),
  desktopExecutable: resolveDesktopExecutable(),
  scriptsRoot,
  env: process.env
});

await mkdir(paths.runRoot, { recursive: true });
await log(`transition requested target=${target}`);
const previous = await inspectPersistedMode(paths);

try {
  await runModeTransition(target, lifecycle);
  await log(`transition completed target=${target}`);
} catch (error) {
  await log(`transition failed target=${target} error=${error?.message ?? String(error)}`);
  const desktopPids = await listCodexDesktopProcessTreePids({
    desktopExecutable: resolveDesktopExecutable()
  }).catch(() => []);
  await recoverFailedModeTransition({ target, previous, lifecycle, desktopPids })
    .then(async ({ restoredMode, cleanupErrors }) => {
      if (restoredMode) await log(`restored mode=${restoredMode}`);
      for (const cleanupError of cleanupErrors) await log(`recovery cleanup failed: ${cleanupError}`);
    })
    .catch(async (recoveryError) => {
      await log(`recovery failed target=${target} error=${recoveryError?.message ?? String(recoveryError)}`);
    });
  process.exitCode = 1;
}

function log(message) {
  return appendFile(paths.modeLog, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
}
