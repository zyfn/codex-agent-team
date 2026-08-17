import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TeamStore } from "../scripts/lib/team-store.mjs";

test("a created team survives a fresh TeamStore instance", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-store-"));
  const file = path.join(home, "teams.json");

  const first = new TeamStore(file);
  const created = await createStoredTeam(first, "commercial", "商业化团队");

  const second = new TeamStore(file);
  const state = await second.read();

  assert.equal(state.version, 2);
  assert.equal(state.revision, 1);
  assert.deepEqual(state.teams, [created]);
});

test("a native thread can belong to only one member", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-binding-"));
  const store = new TeamStore(path.join(home, "teams.json"));
  const firstTeam = await createStoredTeam(store, "payments", "支付团队");
  const secondTeam = await createStoredTeam(store, "growth", "增长团队");

  await store.addMember(firstTeam.id, {
    name: "后端",
    role: "负责服务端",
    cwd: "/tmp/backend",
    threadId: "thread-1"
  });

  await assert.rejects(
    store.addMember(secondTeam.id, {
      name: "后端",
      role: "负责增长服务",
      cwd: "/tmp/growth-backend",
      threadId: "thread-1"
    }),
    { code: "THREAD_BINDING_CONFLICT" }
  );
});

test("editing a member cannot silently change its native thread or workspace", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-edit-"));
  const store = new TeamStore(path.join(home, "teams.json"));
  const team = await createStoredTeam(store, "product", "产品团队");
  const member = await store.addMember(team.id, {
    name: "研究",
    role: "收集信息",
    cwd: "/tmp/research-member",
    threadId: "thread-research"
  });

  const updated = await store.updateMember(team.id, member.id, {
    name: "行业研究",
    role: "收集并分析行业信息"
  });

  assert.equal(updated.cwd, "/tmp/research-member");
  assert.equal(updated.threadId, "thread-research");
  assert.equal(updated.name, "行业研究");
});

test("an explicitly lost empty thread can be rebound without changing member identity", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-rebind-"));
  const store = new TeamStore(path.join(home, "teams.json"));
  const team = await createStoredTeam(store, "product", "产品团队");
  const member = await store.addMember(team.id, {
    name: "研究",
    role: "收集信息",
    cwd: "/tmp/research-member",
    threadId: "thread-empty"
  });

  const rebound = await store.replaceMemberThread(team.id, member.id, "thread-real");

  assert.equal(rebound.id, member.id);
  assert.equal(rebound.cwd, member.cwd);
  assert.equal(rebound.threadId, "thread-real");
});

test("invalid nested team data is preserved instead of overwritten", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-invalid-"));
  const file = path.join(home, "teams.json");
  const original = '{"version":1,"revision":3,"teams":[{"id":7}]}\n';
  await writeFile(file, original);
  const store = new TeamStore(file);

  await assert.rejects(store.createTeam({ name: "不能写入" }), { code: "TEAM_DATA_INVALID" });

  assert.equal(await readFile(file, "utf8"), original);
});

test("renaming and removing Teams and members only changes Team metadata", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-crud-"));
  const store = new TeamStore(path.join(home, "teams.json"));
  const team = await createStoredTeam(store, "team-crud", "原团队");
  const member = await store.addMember(team.id, {
    id: "member-backend",
    name: "后端",
    role: "负责服务端",
    cwd: path.join(team.cwd, "后端"),
    threadId: "thread-backend"
  });

  const renamed = await store.updateTeam(team.id, { name: "新团队" });
  const removedMember = await store.removeMember(team.id, member.id);
  const removedTeam = await store.removeTeam(team.id);

  assert.equal(renamed.name, "新团队");
  assert.equal(removedMember.threadId, "thread-backend");
  assert.equal(removedTeam.name, "新团队");
  assert.deepEqual((await store.read()).teams, []);
});

function createStoredTeam(store, id, name) {
  return store.createTeam({
    id,
    projectId: id,
    name,
    cwd: `/tmp/codex-agent-team/${id}`
  });
}
