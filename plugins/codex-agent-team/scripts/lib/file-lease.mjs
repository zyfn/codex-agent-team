import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";

export async function acquireFileLease(lockFile, {
  timeoutMs = 5_000,
  pollMs = 20,
  busyMessage = "Local data is busy; try again",
  busyError = () => new Error(busyMessage)
} = {}) {
  await mkdir(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();
  for (;;) {
    try {
      const handle = await open(lockFile, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        token,
        createdAt: new Date().toISOString()
      })}\n`);
      return {
        async release() {
          await handle.close().catch(() => undefined);
          try {
            const current = JSON.parse(await readFile(lockFile, "utf8"));
            if (current.token === token) await unlink(lockFile);
          } catch {}
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await lockOwnerIsDead(lockFile)) {
        await unlink(lockFile).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) throw busyError();
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

async function lockOwnerIsDead(lockFile) {
  try {
    const value = JSON.parse(await readFile(lockFile, "utf8"));
    if (!Number.isInteger(value.pid) || value.pid <= 0) return true;
    try {
      process.kill(value.pid, 0);
      return false;
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      if (error?.code === "EPERM") return false;
      throw error;
    }
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    if (error?.code === "EACCES") return false;
    try {
      return Date.now() - (await stat(lockFile)).mtimeMs > 5_000;
    } catch (statError) {
      return statError?.code === "ENOENT";
    }
  }
}
