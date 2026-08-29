import { createHash } from "node:crypto";
import path from "node:path";

import { isSamePathOrInside } from "../paths.mjs";
import { normalizeName } from "./store.mjs";

export function resolveMessageRoute(snapshot, { target, team: teamSelector, cwd, sourceThreadId }) {
  const wanted = requiredText(target, "Target member");
  const teams = Array.isArray(snapshot?.teams) ? snapshot.teams : [];
  const source = findSourceMember(snapshot, { cwd, sourceThreadId });
  const candidateTeams = source
    ? [source.team]
    : selectTeams(teams, teamSelector);
  if (source && teamSelector && !teamMatches(source.team, teamSelector)) {
    throw new Error(`The current member belongs to Team "${source.team.name ?? source.team.teamId}"`);
  }
  const normalized = normalizeName(wanted);
  const matches = candidateTeams.flatMap((team) => (team.members ?? [])
    .filter((member) => normalizeName(member.threadId) === normalized || normalizeName(member.name) === normalized)
    .map((member) => ({ team, member })));
  if (matches.length !== 1) {
    if (!matches.length) {
      const scope = teamSelector ? `Team "${teamSelector}"` : "CodexAgentTeam";
      throw new Error(`${scope} has no member matching: ${wanted}`);
    }
    if (!source && !teamSelector) {
      throw new Error(`Multiple Teams have a member matching "${wanted}"; specify a Team with --team`);
    }
    throw new Error(`Team "${matches[0].team.name ?? matches[0].team.teamId}" has multiple members matching: ${wanted}`);
  }
  const destination = matches[0];
  if (source && destination.member.threadId === source.member.threadId) {
    throw new Error("A Team member cannot message itself");
  }
  return {
    teamId: destination.team.teamId,
    sourceName: source?.member.name ?? "User",
    targetThreadId: destination.member.threadId,
    targetName: destination.member.name,
  };
}

export function resolveCollaborationContext(snapshot, { cwd, sourceThreadId }) {
  const teams = Array.isArray(snapshot?.teams) ? snapshot.teams : [];
  const source = findSourceMember(snapshot, { cwd, sourceThreadId });
  const identity = (member) => ({
    threadId: member.threadId,
    name: member.name,
    role: String(member.role ?? "").trim(),
    cwd: member.cwd
  });
  return {
    currentMember: source ? { teamId: source.team.teamId, ...identity(source.member) } : null,
    teams: (source ? [source.team] : teams).map((team) => ({
      teamId: team.teamId,
      name: team.name,
      sharedDirectory: team.sharedDirectory,
      members: (team.members ?? []).map(identity),
    })),
  };
}

export function messageLeaseFile(paths, targetThreadId) {
  const digest = createHash("sha256").update(requiredText(targetThreadId, "Target Thread id")).digest("hex");
  return path.join(paths.runRoot, "message-locks", `${digest}.lock`);
}

function findSourceMember(snapshot, { cwd, sourceThreadId }) {
  const teams = Array.isArray(snapshot?.teams) ? snapshot.teams : [];
  const candidates = teams.flatMap((team) =>
    (team.members ?? []).map((member) => ({ team, member }))
  );
  let source = sourceThreadId
    ? candidates.find(({ member }) => member.threadId === sourceThreadId)
    : undefined;
  if (!source && cwd) {
    const current = path.resolve(cwd);
    const matches = candidates
      .filter(({ member }) => member.cwd && isSamePathOrInside(current, path.resolve(member.cwd)))
      .sort((left, right) => right.member.cwd.length - left.member.cwd.length);
    if (matches.length > 1 && matches[0].member.cwd.length === matches[1].member.cwd.length) {
      throw new Error("Multiple CodexAgentTeam members share this directory; native Thread identity is required");
    }
    source = matches[0];
  }
  return source;
}

function selectTeams(teams, selector) {
  if (!selector) return teams;
  const matches = teams.filter((team) => teamMatches(team, selector));
  if (!matches.length) throw new Error(`CodexAgentTeam has no Team matching: ${selector}`);
  if (matches.length > 1) throw new Error(`Multiple Teams match: ${selector}; use the Team id`);
  return matches;
}

function teamMatches(team, selector) {
  const normalized = normalizeName(requiredText(selector, "Team"));
  return normalizeName(team.teamId) === normalized || normalizeName(team.name) === normalized;
}

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}
