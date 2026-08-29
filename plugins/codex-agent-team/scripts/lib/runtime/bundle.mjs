import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { probeAppServerCapabilities } from "./app-server.mjs";

const execFileAsync = promisify(execFile);

export async function prepareRuntimeBundle({
  paths,
  scriptsRoot,
  codexCli,
  desktopExecutable,
  nodeExecutable = process.execPath,
  probeAppServer = probeAppServerCapabilities,
  execFileImpl = execFileAsync,
  probeAttempts = 2,
  retryDelayMs = 250,
}) {
  if (!paths || !scriptsRoot || !codexCli || !desktopExecutable || !nodeExecutable) {
    throw new TypeError("CodexAgentTeam requires paths, scripts, Node, Codex, and Desktop");
  }
  await Promise.all([
    access(codexCli, constants.X_OK),
    access(desktopExecutable, constants.X_OK),
    access(nodeExecutable, constants.X_OK),
    mkdir(paths.runRoot, { recursive: true, mode: 0o700 }),
    mkdir(paths.teamsRoot, { recursive: true, mode: 0o700 }),
  ]);
  const [, { stdout: appServerHelp }] = await Promise.all([
    runCapabilityProbe(execFileImpl, codexCli, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
    }, { attempts: probeAttempts, retryDelayMs }),
    runCapabilityProbe(execFileImpl, codexCli, ["app-server", "--help"], {
      encoding: "utf8",
      timeout: 5_000,
    }, { attempts: probeAttempts, retryDelayMs }),
    execFileImpl(nodeExecutable, [
      "-e",
      'process.exit(typeof WebSocket === "function" ? 0 : 1)',
    ], { timeout: 5_000 }),
  ]);
  if (!String(appServerHelp).includes("ws://IP:PORT")) {
    throw new Error("This Codex build does not expose a loopback WebSocket App Server");
  }
  await assertDesktopTeamTransport(desktopExecutable, execFileImpl);
  await probeAppServer({ codexCli, codexHome: paths.codexHome, onStderr: () => {} });

  await rm(paths.runtimeStagingRoot, { recursive: true, force: true });
  await mkdir(paths.runtimeStagingRoot, { recursive: true });
  try {
    await Promise.all([
      cp(scriptsRoot, paths.runtimeStagingScriptsRoot, { recursive: true }),
      cp(path.resolve(scriptsRoot, "..", "assets"), path.join(paths.runtimeStagingRoot, "assets"), {
        recursive: true,
      }),
    ]);
    await access(
      path.join(paths.runtimeStagingScriptsRoot, "lib", "runtime", "run.mjs"),
      constants.R_OK,
    );
    await rm(paths.runtimeBundleRoot, { recursive: true, force: true });
    await rename(paths.runtimeStagingRoot, paths.runtimeBundleRoot);
  } catch (error) {
    await rm(paths.runtimeStagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function assertDesktopTeamTransport(desktopExecutable, execFileImpl) {
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const index = desktopExecutable.lastIndexOf(marker);
  if (index < 0) return;
  const appAsar = path.join(desktopExecutable.slice(0, index), "Contents", "Resources", "app.asar");
  await access(appAsar, constants.R_OK);
  try {
    await execFileImpl("/usr/bin/grep", ["-a", "-q", "CODEX_APP_SERVER_WS_URL", appAsar], {
      timeout: 5_000,
    });
  } catch (error) {
    throw new Error(
      "This Codex Desktop build does not expose a direct WebSocket App Server endpoint",
      { cause: error },
    );
  }
}

async function runCapabilityProbe(
  execFileImpl,
  command,
  args,
  options,
  { attempts, retryDelayMs },
) {
  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    try {
      return await execFileImpl(command, args, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryDelayMs > 0) await delay(retryDelayMs);
    }
  }
  throw lastError;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
