#!/usr/bin/env node

import {
  collectCodexAgentTeamDiagnostics,
  formatRuntimeStatus
} from "./lib/runtime/diagnostics.mjs";
import {
  resolveCodexCli,
  resolveDesktopExecutable,
  resolveNodeExecutable,
  resolvePaths
} from "./lib/paths.mjs";
import { createRuntimeController } from "./lib/runtime/controller.mjs";
import { createCodexAgentTeamManager } from "./lib/manager/index.mjs";
import { createTeamStore } from "./lib/manager/store.mjs";
import { connectActiveAppServer, disconnectActiveAppServer } from "./lib/runtime/app-server.mjs";

const paths = resolvePaths();
const codexCli = resolveCodexCli();
const runtimeController = createRuntimeController({
  paths,
  scriptsRoot: import.meta.dirname,
  codexCli,
  desktopExecutable: resolveDesktopExecutable(),
  nodeExecutable: resolveNodeExecutable()
});

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "launch") await launchCodexAgentTeam();
  else if (command === "status") console.log(formatRuntimeStatus(await runtimeController.status()));
  else if (command === "diagnose") await diagnose();
  else if (command === "shutdown") await shutdownCodexAgentTeam();
  else if (command === "collaborate") await runCollaboration(args[0], args.slice(1));
  else throw usage();
} catch (error) {
  console.error(`Command failed: ${error?.message ?? String(error)}`);
  process.exitCode = 1;
}

async function runCollaboration(command, args) {
  if (command === "context") await runCollaborationCommand(["--context", ...args]);
  else if (command === "send") await runCollaborationCommand(args);
  else throw usage("collaborate context|send [options]");
}

async function launchCodexAgentTeam() {
  console.log("Checking CodexAgentTeam compatibility and launching a separate Codex window…");
  const result = await runtimeController.launch();
  if (result.status === "already_active") {
    console.log("CodexAgentTeam is already running. Continue in its separate Codex window.");
    return;
  }
  console.log("CodexAgentTeam is ready in a separate Codex window. Use Command-Q to quit this current Codex, then continue there.");
}

async function shutdownCodexAgentTeam() {
  const result = await runtimeController.shutdown();
  console.log(result.status === "already_inactive"
    ? "CodexAgentTeam is not running."
    : "CodexAgentTeam shutdown was requested for its own Runtime only.");
}

async function diagnose() {
  const runtimeStatus = await runtimeController.status();
  const checks = await collectCodexAgentTeamDiagnostics({
    paths,
    codexCli,
    desktopExecutable: resolveDesktopExecutable(),
    runtimeStatus
  });
  console.log("CodexAgentTeam diagnostics");
  for (const check of checks) console.log(`${check.ok ? "PASS" : "CHECK"}  ${check.label}: ${check.detail}`);
}

function usage(detail = "launch|status|diagnose|collaborate <command>") {
  return new Error(`Usage: codex-agent-team.mjs ${detail}`);
}

async function runCollaborationCommand(argv, {
  currentWorkingDirectory = process.cwd(),
  sourceThreadId = process.env.CODEX_THREAD_ID,
  stdout = process.stdout
} = {}) {
  const options = parseOptions(argv);
  const store = createTeamStore(paths.teamsFile);
  const source = {
    cwd: options.cwd || currentWorkingDirectory,
    sourceThreadId: options["source-thread"] || sourceThreadId
  };
  const appServer = await connectActiveAppServer({
    runtimeState: paths.runtimeState,
    clientName: "codex-agent-team-collaboration"
  });
  try {
    const manager = createCodexAgentTeamManager({
      store,
      rpc: appServer.rpc,
      teamsRoot: paths.teamsRoot,
      dataRoot: paths.dataRoot
    });
    if (options.context) {
      stdout.write(`${JSON.stringify(await manager.collaborationContext(source))}\n`);
      return;
    }
    const receipt = await manager.collaborate({
      ...source,
      team: options.team,
      target: requiredOption(options.target, "Target member"),
      message: requiredOption(options.message, "Message")
    });
    stdout.write(`${JSON.stringify({ accepted: receipt.accepted === true, target: receipt.target })}\n`);
  } finally {
    await disconnectActiveAppServer(appServer);
  }
}

function parseOptions(argv) {
  const result = {};
  for (let index = 0; index < argv.length;) {
    const key = argv[index]?.replace(/^--/, "");
    if (!key) throw new Error(`Invalid option: ${argv[index]}`);
    if (key === "context") {
      result[key] = true;
      index += 1;
      continue;
    }
    if (argv[index + 1] === undefined) throw new Error(`Invalid option: ${argv[index]}`);
    result[key] = argv[index + 1];
    index += 2;
  }
  return result;
}

function requiredOption(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}
