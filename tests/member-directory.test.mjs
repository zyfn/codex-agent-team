import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createMemberDirectory,
  inspectGitSource,
} from "../plugins/codex-agent-team/scripts/lib/manager/member-directory.mjs";

const execFileAsync = promisify(execFile);

test("a member without a Git source gets an empty Team-owned directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-empty-member-"));
  const directory = await createMemberDirectory({
    teamDirectory: path.join(root, "team"),
    operationId: "operation-frontend",
    memberName: "Frontend",
  });

  assert.equal(directory.cwd, path.join(root, "team", "members", "Frontend"));
  assert.equal((await lstat(directory.cwd)).isDirectory(), true);
  await directory.cleanup();
});

test("a local Git repository becomes an isolated worktree in the Member Directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-local-worktree-"));
  const source = await createGitRepository(root, "source");
  const directory = await createMemberDirectory({
    teamDirectory: path.join(root, "team"),
    operationId: "operation-backend",
    memberName: "Backend",
    localGitDirectory: source,
  });

  assert.equal(directory.cwd, path.join(root, "team", "members", "Backend"));
  assert.equal((await lstat(path.join(directory.cwd, ".git"))).isFile(), true);
  assert.equal(
    (await execFileAsync("git", ["-C", directory.cwd, "branch", "--show-current"])).stdout.trim(),
    "codex-agent-team/operation-backend",
  );
  await writeFile(path.join(directory.cwd, "app.txt"), "member change");
  assert.equal(await readFile(path.join(source, "app.txt"), "utf8"), "original");
});

test("a remote Git URL is cloned into the Member Directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-remote-clone-"));
  const source = await createGitRepository(root, "remote-source");
  const directory = await createMemberDirectory({
    teamDirectory: path.join(root, "team"),
    operationId: "operation-client",
    memberName: "Client",
    remoteGitUrl: `file://${source}`,
  });

  assert.equal(directory.cwd, path.join(root, "team", "members", "Client"));
  assert.equal(await readFile(path.join(directory.cwd, "app.txt"), "utf8"), "original");
});

test("Git source inspection returns the repository root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-git-inspect-"));
  const source = await createGitRepository(root, "source");
  const nested = path.join(source, "nested");
  await mkdir(nested);

  assert.deepEqual(await inspectGitSource(nested), {
    path: await realpath(nested),
    isGit: true,
    gitRoot: await realpath(source),
  });
});

test("a non-Git local directory is rejected instead of being used directly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-non-git-"));
  const source = path.join(root, "source");
  await mkdir(source);

  await assert.rejects(
    createMemberDirectory({
      teamDirectory: path.join(root, "team"),
      operationId: "operation-backend",
      memberName: "Backend",
      localGitDirectory: source,
    }),
    { code: "GIT_REPOSITORY_REQUIRED" },
  );
});

async function createGitRepository(root, name) {
  const source = path.join(root, name);
  await mkdir(source);
  await execFileAsync("git", ["init", source]);
  await execFileAsync("git", ["-C", source, "config", "user.email", "agentteam@example.com"]);
  await execFileAsync("git", ["-C", source, "config", "user.name", "CodexAgentTeam Test"]);
  await writeFile(path.join(source, "app.txt"), "original");
  await execFileAsync("git", ["-C", source, "add", "app.txt"]);
  await execFileAsync("git", ["-C", source, "commit", "-m", "initial"]);
  return source;
}
