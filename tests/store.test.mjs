import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTeamStore } from "../plugins/codex-agent-team/scripts/lib/manager/store.mjs";

test("a Team record stores only native Team identity, paths, and members", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-store-"));
  const file = path.join(home, "teams.json");
  const created = await createStoredTeam(createTeamStore(file), "team-1");
  const state = await createTeamStore(file).read();

  assert.equal(state.version, 1);
  assert.equal("revision" in state, false);
  assert.deepEqual(state.teams, [created]);
  assert.deepEqual(Object.keys(created).sort(), [
    "members",
    "teamDirectory",
    "teamId",
  ]);
});

test("unsupported pre-release schemas fail closed instead of migrating", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-old-store-"));
  const file = path.join(home, "teams.json");
  const original = '{"version":6,"teams":[]}\n';
  await writeFile(file, original);

  await assert.rejects(createTeamStore(file).read(), { code: "TEAM_DATA_INVALID" });
  assert.equal(await readFile(file, "utf8"), original);
});

test("independent Store instances serialize Team creation", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-concurrent-store-"));
  const file = path.join(home, "teams.json");
  await Promise.all([
    createStoredTeam(createTeamStore(file), "team-one"),
    createStoredTeam(createTeamStore(file), "team-two"),
  ]);

  const state = await createTeamStore(file).read();
  assert.deepEqual(state.teams.map(({ teamId }) => teamId).sort(), ["team-one", "team-two"]);
});

test("a native Thread can belong to only one member", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-binding-"));
  const store = createTeamStore(path.join(home, "teams.json"));
  const first = await createStoredTeam(store, "payments");
  const second = await createStoredTeam(store, "growth");
  await store.addMember(first.teamId, memberInput("Backend", "thread-1"));

  await assert.rejects(
    store.addMember(second.teamId, memberInput("Growth", "thread-1")),
    { code: "THREAD_BINDING_CONFLICT" },
  );
});

test("editing a member preserves its native Thread binding", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-edit-"));
  const store = createTeamStore(path.join(home, "teams.json"));
  const team = await createStoredTeam(store, "product");
  const member = await store.addMember(
    team.teamId,
    memberInput("Research", "thread-research"),
  );

  const updated = await store.updateMember(team.teamId, member.threadId, {
    name: "Industry Research",
    role: "Analyze the market",
  });

  assert.equal(updated.threadId, "thread-research");
  assert.equal(updated.name, "Industry Research");
});

test("removing a member and Team changes only registration data", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-remove-"));
  const store = createTeamStore(path.join(home, "teams.json"));
  const team = await createStoredTeam(store, "team-remove");
  const member = await store.addMember(
    team.teamId,
    memberInput("Backend", "thread-backend"),
  );

  assert.equal((await store.removeMember(team.teamId, member.threadId)).threadId, "thread-backend");
  assert.equal((await store.removeTeam(team.teamId)).teamId, team.teamId);
  assert.deepEqual((await store.read()).teams, []);
});

function createStoredTeam(store, teamId) {
  return store.createTeam({
    teamId,
    teamDirectory: `/tmp/codex-agent-team/${teamId}`,
  });
}

function memberInput(name, threadId) {
  return { name, role: "", threadId };
}
