import { createHash } from "node:crypto";
import path from "node:path";

import { isSamePathOrInside } from "../paths.mjs";
import { normalizeName } from "./store.mjs";

export function resolveMessageRoute(snapshot, { target, cwd, sourceThreadId }) {
  const wanted = requiredText(target, "Target member");
  const source = resolveSourceMember(snapshot, { cwd, sourceThreadId });
  const normalized = normalizeName(wanted);
  const matches = source.team.members.filter((member) =>
    normalizeName(member.threadId) === normalized || normalizeName(member.name) === normalized
  );
  if (matches.length !== 1) {
    const teamLabel = source.team.name ?? source.team.teamId;
    if (!matches.length) throw new Error(`Team "${teamLabel}" has no member matching: ${wanted}`);
    throw new Error(`Team "${teamLabel}" has multiple members matching: ${wanted}`);
  }
  const destination = matches[0];
  if (destination.threadId === source.member.threadId) throw new Error("A Team member cannot message itself");
  return {
    teamId: source.team.teamId,
    sourceName: source.member.name,
    targetThreadId: destination.threadId,
    targetName: destination.name,
  };
}

export function resolveMemberContext(snapshot, { cwd, sourceThreadId }) {
  const source = resolveSourceMember(snapshot, { cwd, sourceThreadId });
  const identity = (team, member) => ({
    threadId: member.threadId,
    name: member.name,
    role: String(member.role ?? "").trim(),
    cwd: memberDirectory(team, member),
  });
  return {
    team: {
      teamId: source.team.teamId,
      name: source.team.name,
      sharedDirectory: source.team.sharedDirectory,
    },
    self: identity(source.team, source.member),
    peers: source.team.members
      .filter((member) => member.threadId !== source.member.threadId)
      .map((member) => identity(source.team, member)),
  };
}

export function messageLeaseFile(paths, targetThreadId) {
  const digest = createHash("sha256").update(requiredText(targetThreadId, "Target Thread id")).digest("hex");
  return path.join(paths.runRoot, "message-locks", `${digest}.lock`);
}

function resolveSourceMember(snapshot, { cwd, sourceThreadId }) {
  const teams = Array.isArray(snapshot?.teams) ? snapshot.teams : [];
  const candidates = teams.flatMap((team) =>
    (team.members ?? []).map((member) => ({
      team,
      member,
      cwd: memberDirectory(team, member),
    }))
  );
  let source = sourceThreadId
    ? candidates.find(({ member }) => member.threadId === sourceThreadId)
    : undefined;
  if (!source && cwd) {
    const current = path.resolve(cwd);
    const matches = candidates
      .filter((candidate) => candidate.cwd && isSamePathOrInside(current, path.resolve(candidate.cwd)))
      .sort((left, right) => right.cwd.length - left.cwd.length);
    if (matches.length > 1 && matches[0].cwd.length === matches[1].cwd.length) {
      throw new Error("Multiple CodexAgentTeam members share this directory; native Thread identity is required");
    }
    source = matches[0];
  }
  if (!source) throw new Error("The current conversation or directory is not a CodexAgentTeam member");
  return source;
}

function memberDirectory(team, member) {
  if (typeof member?.cwd === "string" && member.cwd.trim()) return member.cwd;
  if (!team?.teamDirectory || !member?.name) return null;
  return path.join(team.teamDirectory, "members", member.name);
}

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}
