import { cp, lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export class WorkspaceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

export async function materializeWorkspace({ root, memberName, source = null }) {
  const safeName = validateDirectoryName(memberName);
  const resolvedRoot = path.resolve(root);
  const destination = path.join(resolvedRoot, safeName);
  await mkdir(resolvedRoot, { recursive: true });

  try {
    await lstat(destination);
    throw new WorkspaceError("WORKSPACE_EXISTS", `Workspace already exists: ${destination}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (!source) {
    await mkdir(destination, { recursive: false });
    return destination;
  }

  const resolvedSource = await realpath(path.resolve(source));
  if (resolvedSource === destination || destination.startsWith(`${resolvedSource}${path.sep}`)) {
    throw new WorkspaceError("WORKSPACE_OVERLAP", "Destination cannot be inside the source project");
  }
  await assertNoSymlinks(resolvedSource);
  await cp(resolvedSource, destination, {
    recursive: true,
    errorOnExist: true,
    filter: (entry) => path.basename(entry) !== ".git"
  });
  return destination;
}

async function assertNoSymlinks(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const candidate = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new WorkspaceError("PROJECT_SYMLINK_UNSAFE", `Project contains a symbolic link: ${candidate}`);
    }
    if (entry.isDirectory()) await assertNoSymlinks(candidate);
  }
}

function validateDirectoryName(value) {
  const name = String(value ?? "").trim();
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new WorkspaceError("MEMBER_NAME_INVALID", "Member name cannot be used as a directory name");
  }
  return name;
}
