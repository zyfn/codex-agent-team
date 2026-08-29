import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { createTeamStore } from "../manager/store.mjs";

const execFileAsync = promisify(execFile);

export function buildMemberResumeCommand({
  codexCli,
  codexHome,
  cwd,
  threadId,
  remoteUrl = "unix://",
  developerInstructions = null,
}) {
  return [
    ...(codexHome ? ["env", `CODEX_HOME=${shellQuote(codexHome)}`] : []),
    shellQuote(required(codexCli, "Codex CLI")),
    ...(developerInstructions
      ? ["-c", shellQuote(`developer_instructions=${JSON.stringify(developerInstructions)}`)]
      : []),
    "--remote",
    shellQuote(required(remoteUrl, "App Server URL")),
    "-C",
    shellQuote(required(cwd, "Member cwd")),
    "resume",
    shellQuote(required(threadId, "Member threadId"))
  ].join(" ");
}

export function formatRuntimeStatus(status) {
  if (status?.state === "active") return "CodexAgentTeam: running and connected";
  if (status?.state === "opening") return "CodexAgentTeam: launching";
  if (status?.state === "failed") return `CodexAgentTeam: needs attention: ${status.error || "unknown error"}`;
  return "CodexAgentTeam: off";
}

export async function readCodexDesktopVersion(
  desktopExecutable,
  { execFileImpl = execFileAsync, platform = process.platform } = {}
) {
  if (platform !== "darwin") return null;
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const markerIndex = desktopExecutable.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const infoPlist = path.join(desktopExecutable.slice(0, markerIndex), "Contents", "Info.plist");
  const { stdout } = await execFileImpl(
    "/usr/bin/defaults",
    ["read", infoPlist, "CFBundleShortVersionString"],
    { encoding: "utf8", timeout: 5_000 }
  );
  return stdout.trim() || null;
}

export async function collectCodexAgentTeamDiagnostics({ paths, codexCli, desktopExecutable, runtimeStatus }) {
  const checks = [];
  try {
    const { stdout } = await execFileAsync(codexCli, ["--version"], { encoding: "utf8", timeout: 5_000 });
    checks.push({ label: "Codex CLI", ok: true, detail: stdout.trim() });
  } catch (error) {
    checks.push({ label: "Codex CLI", ok: false, detail: error.message });
  }
  try {
    await access(desktopExecutable, constants.X_OK);
    const version = await readCodexDesktopVersion(desktopExecutable).catch(() => null);
    checks.push({
      label: "Codex Desktop",
      ok: true,
      detail: version ? `${version} · ${desktopExecutable}` : desktopExecutable
    });
  } catch (error) {
    checks.push({ label: "Codex Desktop", ok: false, detail: error.message });
  }
  try {
    const runtime = JSON.parse(await readFile(paths.runtimeState, "utf8"));
    const failedOpen = runtimeStatus?.state === "failed";
    checks.push({
      label: "Desktop Bridge",
      ok: !failedOpen && ["opening", "active"].includes(runtime.state),
      detail: failedOpen
        ? runtimeStatus.error || "automatic takeover disabled"
        : runtime.error ?? runtime.step ?? runtime.state ?? "not running"
    });
  } catch {
    checks.push({ label: "Desktop Bridge", ok: runtimeStatus?.state === "off", detail: "off" });
  }
  checks.push({
    label: "Codex App Server",
    ok: ["off", "opening"].includes(runtimeStatus?.state)
      || (runtimeStatus?.state === "active" && Boolean(runtimeStatus?.appServerUrl)),
    detail: runtimeStatus?.state === "active" && runtimeStatus?.appServerUrl
      ? `CodexAgentTeam-owned official App Server${runtimeStatus.appServerPid ? ` · PID ${runtimeStatus.appServerPid}` : ""}${runtimeStatus.appServerGuardianPid ? ` · guardian ${runtimeStatus.appServerGuardianPid}` : ""}`
      : runtimeStatus?.state === "opening"
        ? "client not connected yet"
        : runtimeStatus?.state === "off" ? "not used (CodexAgentTeam closed)" : "not connected"
  });
  try {
    const state = await createTeamStore(paths.teamsFile).read();
    const members = state.teams.reduce((total, team) => total + team.members.length, 0);
    checks.push({ label: "Team data", ok: true, detail: `${state.teams.length} teams, ${members} members` });
  } catch (error) {
    checks.push({ label: "Team data", ok: false, detail: error.message });
  }
  checks.push({ label: "Runtime", ok: runtimeStatus?.state !== "failed", detail: formatRuntimeStatus(runtimeStatus) });
  try {
    const log = await readFile(paths.runtimeLog, "utf8");
    const latest = stripAnsi(log.trim().split("\n").at(-1) ?? "");
    const currentFailure = runtimeStatus?.state === "failed";
    if (latest && currentFailure) {
      checks.push({
        label: "Current error",
        ok: false,
        detail: latest
      });
    }
  } catch {}
  return checks;
}

function stripAnsi(value) {
  return String(value).replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, "");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}
