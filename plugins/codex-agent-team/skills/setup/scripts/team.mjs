#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { sendIpc } from "./lib/ipc.mjs";
import { isCodexDesktopPinnedToLocalDaemon } from "./lib/desktop-lifecycle.mjs";
import { resolveCodexCli, resolveDesktopExecutable, resolvePaths } from "./lib/paths.mjs";
import { TeamStore } from "./lib/team-store.mjs";
import {
  inspectPersistedMode,
  launchModeTransition,
  preflightModeTransition,
  TeamModeManager
} from "./lib/team-mode-manager.mjs";
import {
  buildCliResumeCommand,
  diagnoseEnvironment,
  findTeamMember,
  formatRuntimeStatus
} from "./lib/team-command.mjs";

const paths = resolvePaths();
const [command, ...args] = process.argv.slice(2);
const teamStore = new TeamStore(paths.teamsFile);
const modeManager = new TeamModeManager({
  inspectMode: async () => {
    const persisted = await inspectPersistedMode(paths);
    return {
      ...persisted,
      runtimeReady: (await status()).phase === "ready",
      teamTransportReady: await transportReady(persisted),
      daemonEnvironment: await isCodexDesktopPinnedToLocalDaemon().catch(() => false)
    };
  },
  preflight: (target) => preflightModeTransition({
    target,
    paths,
    codexCli: resolveCodexCli(),
    desktopExecutable: resolveDesktopExecutable(),
    teamStore
  }),
  transition: (target) => launchModeTransition({
    target,
    paths,
    scriptsRoot: import.meta.dirname
  })
});

try {
  if (command === "open") await changeMode("team", args.includes("--confirm"));
  else if (command === "status") console.log(formatRuntimeStatus(await status()));
  else if (command === "close") await changeMode("normal", args.includes("--confirm"));
  else if (command === "diagnose") await diagnose();
  else if (command === "cli") await cliCommand(args);
  else if (command === "snapshot") console.log(JSON.stringify(await sendIpc(paths.runtimeSocket, { type: "snapshot" }), null, 2));
  else if (command === "send") {
    const value = await sendMessage(args);
    console.log(`团队消息已送达目标会话（turn ${value.turnId}）`);
  } else throw new Error("Usage: team.mjs open [--confirm]|status|close [--confirm]|diagnose|cli|snapshot|send");
} catch (error) {
  console.error(`执行失败：${error?.message ?? String(error)}`);
  process.exitCode = 1;
}

async function changeMode(target, confirmed) {
  console.log(target === "team" ? "正在检查团队模式…" : "正在检查普通模式恢复条件…");
  const result = confirmed ? await modeManager.confirm(target) : await modeManager.prepare(target);
  if (result.status === "already_active") {
    console.log(target === "team" ? "团队模式已经在运行。" : "当前已经是普通模式。");
    return;
  }
  if (result.status === "confirmation_required") {
    console.log(result.message);
    console.log("请先向用户确认；只有用户明确同意后才能继续切换。");
    return;
  }
  console.log(target === "team"
    ? "已确认。接下来将请求 Codex 正常退出，并在退出后进入团队模式。"
    : "已确认。接下来将请求 Codex 正常退出，并在退出后恢复普通模式。");
}

async function status() {
  try {
    return await sendIpc(paths.runtimeSocket, { type: "status" }, 1_000);
  } catch {
    try {
      const state = JSON.parse(await readFile(paths.runtimeState, "utf8"));
      return state.phase === "failed" ? state : { phase: "off" };
    } catch {
      return { phase: "off" };
    }
  }
}

async function transportReady(mode) {
  if (mode?.mode !== "team" || !Number.isInteger(mode.relayPort) || mode.relayPort <= 0) return false;
  try {
    const state = JSON.parse(await readFile(paths.relayState, "utf8"));
    return state.phase === "ready" && state.port === mode.relayPort && Number.isInteger(state.pid);
  } catch {
    return false;
  }
}

async function sendMessage(argv) {
  const options = parseOptions(argv);
  return sendIpc(paths.runtimeSocket, {
    type: "send",
    teamId: required(options["team-id"], "--team-id"),
    sourceName: required(options.from, "--from"),
    targetMemberId: required(options["member-id"], "--member-id"),
    message: required(options.message, "--message")
  }, 30_000);
}

async function diagnose() {
  const checks = await diagnoseEnvironment({
    paths,
    codexCli: resolveCodexCli(),
    desktopExecutable: resolveDesktopExecutable(),
    runtimeStatus: await status()
  });
  console.log("Codex Agent Team 自检");
  for (const check of checks) {
    console.log(`${check.ok ? "通过" : "注意"}  ${check.label}：${check.detail}`);
  }
}

async function cliCommand(argv) {
  const options = parseOptions(argv);
  const state = await new TeamStore(paths.teamsFile).read();
  const { team, member } = findTeamMember(state, {
    team: required(options.team, "--team"),
    member: required(options.member, "--member")
  });
  const mode = await inspectPersistedMode(paths);
  if (mode.mode !== "team" || !Number.isInteger(mode.relayPort) || mode.relayPort <= 0) {
    throw new Error("Team mode must be active before opening a member in CLI");
  }
  console.log(`${team.name} / ${member.name}`);
  console.log(buildCliResumeCommand({
    codexCli: resolveCodexCli(),
    cwd: member.cwd,
    threadId: member.threadId,
    websocketUrl: `ws://127.0.0.1:${mode.relayPort}/rpc`
  }));
}

function parseOptions(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "");
    if (!key || argv[index + 1] === undefined) throw new Error(`Invalid option: ${argv[index]}`);
    result[key] = argv[index + 1];
  }
  return result;
}

function required(value, flag) {
  if (!value) throw new Error(`${flag} is required`);
  return value;
}
