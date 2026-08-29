import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, realpath, rmdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { isSamePathOrInside } from "../paths.mjs";

const execFileAsync = promisify(execFile);

export async function inspectGitSource(directory) {
  const selected = await realpath(path.resolve(required(directory, "Git repository")));
  const gitRoot = await findGitRoot(selected);
  return { path: selected, isGit: Boolean(gitRoot), gitRoot };
}

export async function createMemberDirectory({
  teamDirectory,
  operationId,
  memberName,
  localGitDirectory = null,
  remoteGitUrl = null,
}) {
  if (localGitDirectory && remoteGitUrl) {
    throw directoryError("MULTIPLE_GIT_SOURCES", "Choose either a local or remote Git repository");
  }
  const membersDirectory = path.join(
    path.resolve(required(teamDirectory, "Team directory")),
    "members",
  );
  await mkdir(membersDirectory, { recursive: true, mode: 0o700 });
  const destination = path.join(membersDirectory, validateDirectoryName(memberName));

  if (!localGitDirectory && !remoteGitUrl) {
    await createDestination(destination);
    return {
      cwd: destination,
      kind: "empty",
      async cleanup() { await rmdir(destination); },
    };
  }

  if (remoteGitUrl) {
    const url = validateRemoteGitUrl(remoteGitUrl);
    try {
      await execFileAsync("git", ["clone", "--", url, destination], {
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      await chmod(destination, 0o700);
      return {
        cwd: destination,
        kind: "clone",
        async cleanup() { await rm(destination, { recursive: true, force: true }); },
      };
    } catch (error) {
      await rm(destination, { recursive: true, force: true }).catch(() => undefined);
      throw directoryError("GIT_CLONE_FAILED", `Could not clone Git repository: ${error.message}`, error);
    }
  }

  const selected = await realpath(path.resolve(localGitDirectory));
  const gitRoot = await findGitRoot(selected);
  if (!gitRoot) {
    throw directoryError("GIT_REPOSITORY_REQUIRED", "Selected directory must belong to a Git repository");
  }
  const branch = managedBranchName(operationId);
  try {
    await execFileAsync("git", [
      "-C", gitRoot,
      "worktree", "add", "-b", branch, destination, "HEAD",
    ], { timeout: 60_000, maxBuffer: 1024 * 1024 });
    await chmod(destination, 0o700);
    return {
      cwd: destination,
      kind: "worktree",
      async cleanup() { await discardWorktree({ cwd: destination, teamDirectory }); },
    };
  } catch (error) {
    await rm(destination, { recursive: true, force: true }).catch(() => undefined);
    await execFileAsync("git", ["-C", gitRoot, "worktree", "prune"]).catch(() => undefined);
    throw directoryError(
      "GIT_WORKTREE_CREATE_FAILED",
      `Could not create Git worktree: ${error.message}`,
      error,
    );
  }
}

async function createDestination(destination) {
  try {
    await mkdir(destination, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw directoryError(
        "MEMBER_DIRECTORY_EXISTS",
        `Member directory already exists: ${destination}`,
        error,
      );
    }
    throw error;
  }
}

async function discardWorktree({ cwd, teamDirectory }) {
  const teamRoot = await realpath(path.resolve(teamDirectory));
  const worktreeRoot = await realpath(path.resolve(cwd));
  const gitRoot = await findGitRoot(worktreeRoot);
  const dotGit = gitRoot ? await lstat(path.join(gitRoot, ".git")).catch(() => null) : null;
  if (!gitRoot || !dotGit?.isFile() || !isSamePathOrInside(gitRoot, teamRoot)) {
    throw directoryError("WORKTREE_NOT_MANAGED", `Refusing to discard unmanaged worktree: ${worktreeRoot}`);
  }
  const branch = await currentBranch(gitRoot);
  if (!branch?.startsWith("codex-agent-team/")) {
    throw directoryError("WORKTREE_NOT_MANAGED", `Unexpected worktree branch: ${gitRoot}`);
  }
  const { stdout: status } = await execFileAsync("git", [
    "-C", gitRoot,
    "status", "--porcelain", "--untracked-files=all",
  ], { encoding: "utf8", timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
  if (status.trim()) {
    throw directoryError("WORKTREE_DIRTY", `New member worktree contains changes and was preserved: ${gitRoot}`);
  }
  const { stdout } = await execFileAsync("git", [
    "-C", gitRoot,
    "rev-parse", "--git-common-dir",
  ], { encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024 });
  const commonDir = path.resolve(gitRoot, stdout.trim());
  await execFileAsync("git", ["--git-dir", commonDir, "worktree", "remove", gitRoot], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  await execFileAsync("git", ["--git-dir", commonDir, "branch", "-D", branch], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
}

async function findGitRoot(directory) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", directory, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    const root = stdout.trim();
    return root ? await realpath(root) : null;
  } catch {
    return null;
  }
}

async function currentBranch(gitRoot) {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C", gitRoot,
      "symbolic-ref", "--quiet", "--short", "HEAD",
    ], { encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function validateRemoteGitUrl(value) {
  const url = required(value, "Remote Git URL");
  if (/^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/)/i.test(url) || /^[^\s@]+@[^\s:]+:.+/.test(url)) {
    return url;
  }
  throw directoryError("REMOTE_GIT_URL_INVALID", "Remote Git URL must use HTTPS, SSH, Git, or scp syntax");
}

function validateDirectoryName(value) {
  const name = String(value ?? "").trim();
  if (!name || name.length > 80 || name === "." || name === ".." ||
    name.includes("/") || name.includes("\\") || /[\u0000-\u001F\u007F]/.test(name)) {
    throw directoryError("MEMBER_NAME_INVALID", "Member name cannot be used as a directory name");
  }
  return name;
}

function managedBranchName(value) {
  const operationId = required(value, "Operation id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(operationId)) {
    throw directoryError("OPERATION_ID_INVALID", "Operation id is invalid");
  }
  return `codex-agent-team/${operationId}`;
}

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw directoryError("VALUE_REQUIRED", `${label} is required`);
  return text;
}

function directoryError(code, message, cause) {
  return Object.assign(new Error(message, { cause }), { code });
}
