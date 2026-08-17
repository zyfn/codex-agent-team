import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { materializeWorkspace } from "../scripts/lib/workspace.mjs";

test("a local project is copied into an independent member directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-workspace-"));
  const source = path.join(root, "source");
  const destinationRoot = path.join(root, "members");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(source));
  await writeFile(path.join(source, "app.txt"), "original");

  const cwd = await materializeWorkspace({
    root: destinationRoot,
    memberName: "前端",
    source
  });
  await writeFile(path.join(cwd, "app.txt"), "member change");

  assert.equal(await readFile(path.join(source, "app.txt"), "utf8"), "original");
  assert.equal(path.basename(cwd), "前端");
});
