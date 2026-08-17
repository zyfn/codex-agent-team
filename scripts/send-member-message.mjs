#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import { sendIpc } from "./lib/ipc.mjs";
import { resolvePaths } from "./lib/paths.mjs";

export function resolveMemberRoute(snapshot, { target, cwd, sourceThreadId }) {
  const wanted = requiredText(target, "Target member");
  const teams = Array.isArray(snapshot?.teams) ? snapshot.teams : [];
  const candidates = teams.flatMap((team) =>
    (team.members ?? []).map((member) => ({ team, member }))
  );
  let source = sourceThreadId
    ? candidates.find(({ member }) => member.threadId === sourceThreadId)
    : undefined;
  if (!source && cwd) {
    const current = path.resolve(cwd);
    source = candidates
      .filter(({ member }) => member.cwd && sameOrInside(current, path.resolve(member.cwd)))
      .sort((left, right) => right.member.cwd.length - left.member.cwd.length)[0];
  }
  if (!source) throw new Error("当前会话或目录不属于任何 AgentTeam 成员");
  const matches = source.team.members.filter((member) => member.id === wanted || member.name === wanted);
  if (matches.length !== 1) {
    if (!matches.length) throw new Error(`团队「${source.team.name}」中没有成员：${wanted}`);
    throw new Error(`团队「${source.team.name}」中有多个成员匹配：${wanted}`);
  }
  const destination = matches[0];
  if (destination.id === source.member.id) throw new Error("不能向自己发送团队消息");
  return {
    teamId: source.team.id,
    sourceName: source.member.name,
    targetMemberId: destination.id,
    targetName: destination.name,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const paths = resolvePaths();
  const snapshot = await sendIpc(paths.runtimeSocket, { type: "snapshot" });
  const route = resolveMemberRoute(snapshot, {
    target: options.target,
    cwd: options.cwd || process.cwd(),
    sourceThreadId: options["source-thread"] || process.env.CODEX_THREAD_ID,
  });
  const receipt = await sendIpc(paths.runtimeSocket, {
    type: "send",
    teamId: route.teamId,
    sourceName: route.sourceName,
    targetMemberId: route.targetMemberId,
    message: requiredText(options.message, "Message"),
  }, 30_000);
  process.stdout.write(`${JSON.stringify({ accepted: receipt.accepted === true, target: route.targetName })}\n`);
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

function sameOrInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
