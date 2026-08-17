import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { readDaemonVersion } from "./daemon.mjs";
import { TeamStore } from "./team-store.mjs";

const execFileAsync = promisify(execFile);

export function buildCliResumeCommand({ codexCli, cwd, threadId, websocketUrl }) {
  return [
    "CODEX_APP_SERVER_USE_LOCAL_DAEMON=1",
    `CODEX_APP_SERVER_WS_URL=${shellQuote(required(websocketUrl, "Team transport URL"))}`,
    shellQuote(required(codexCli, "Codex CLI")),
    "-C",
    shellQuote(required(cwd, "Member cwd")),
    "resume",
    shellQuote(required(threadId, "Member threadId"))
  ].join(" ");
}

export function findTeamMember(state, selectors) {
  const teamSelector = comparable(required(selectors.team, "--team"));
  const memberSelector = comparable(required(selectors.member, "--member"));
  const team = state.teams.find((candidate) =>
    comparable(candidate.id) === teamSelector || comparable(candidate.name) === teamSelector
  );
  if (!team) throw new Error(`Team not found: ${selectors.team}`);
  const member = team.members.find((candidate) =>
    comparable(candidate.id) === memberSelector || comparable(candidate.name) === memberSelector
  );
  if (!member) throw new Error(`Member not found in ${team.name}: ${selectors.member}`);
  return { team, member };
}

export function formatRuntimeStatus(status) {
  if (status?.phase === "ready") return "团队模式：运行中";
  if (status?.phase === "opening") return "团队模式：正在启动";
  if (status?.phase === "failed") return `团队模式：启动失败：${status.error || "未知错误"}`;
  return "团队模式：未开启";
}

export async function diagnoseEnvironment({ paths, codexCli, desktopExecutable, runtimeStatus }) {
  const checks = [];
  try {
    const { stdout } = await execFileAsync(codexCli, ["--version"], { encoding: "utf8", timeout: 5_000 });
    checks.push({ label: "Codex CLI", ok: true, detail: stdout.trim() });
  } catch (error) {
    checks.push({ label: "Codex CLI", ok: false, detail: error.message });
  }
  try {
    await access(desktopExecutable, constants.X_OK);
    checks.push({ label: "Codex Desktop", ok: true, detail: desktopExecutable });
  } catch (error) {
    checks.push({ label: "Codex Desktop", ok: false, detail: error.message });
  }
  try {
    const daemon = await readDaemonVersion(codexCli, { codexHome: paths.codexHome });
    checks.push({ label: "本地 App Server", ok: daemon.status === "running", detail: daemon.appServerVersion ?? daemon.status });
  } catch {
    checks.push({ label: "本地 App Server", ok: false, detail: "未运行；打开团队模式时会自动启动" });
  }
  try {
    const relay = JSON.parse(await readFile(paths.relayState, "utf8"));
    const ready = relay.phase === "ready" && Number.isInteger(relay.port) && relay.port > 0;
    checks.push({
      label: "团队传输",
      ok: ready,
      detail: ready ? `已连接，${relay.activeConnections ?? 0} 个客户端` : relay.error ?? relay.phase ?? "未就绪"
    });
  } catch {
    checks.push({
      label: "团队传输",
      ok: runtimeStatus?.phase !== "ready",
      detail: runtimeStatus?.phase === "ready" ? "运行状态缺失" : "未开启"
    });
  }
  try {
    const state = await new TeamStore(paths.teamsFile).read();
    const members = state.teams.reduce((total, team) => total + team.members.length, 0);
    checks.push({ label: "团队数据", ok: true, detail: `${state.teams.length} 个团队，${members} 位成员` });
  } catch (error) {
    checks.push({ label: "团队数据", ok: false, detail: error.message });
  }
  checks.push({ label: "运行状态", ok: runtimeStatus?.phase !== "failed", detail: formatRuntimeStatus(runtimeStatus) });
  try {
    const log = await readFile(paths.runtimeLog, "utf8");
    const latest = log.trim().split("\n").at(-1);
    if (latest) checks.push({ label: "最近日志", ok: true, detail: latest });
  } catch {}
  return checks;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function comparable(value) {
  return String(value).normalize("NFKC").trim().toLocaleLowerCase();
}

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}
