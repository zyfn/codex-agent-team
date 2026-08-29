import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveNodeExecutable } from "../plugins/codex-agent-team/scripts/lib/paths.mjs";

test("one-shot Runtime falls back to a PATH node when the stable bundled runtime is unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-node-"));
  const executable = path.join(root, "node");
  await writeFile(executable, "#!/bin/sh\n");
  await chmod(executable, 0o755);

  assert.equal(resolveNodeExecutable({ PATH: root }, { bundledNode: path.join(root, "missing") }), executable);
});

test("one-shot Runtime accepts the alternate Codex bundled Node layout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-node-alternate-"));
  const alternate = path.join(root, "node");
  await writeFile(alternate, "#!/bin/sh\n");
  await chmod(alternate, 0o755);

  assert.equal(resolveNodeExecutable({ PATH: "" }, {
    bundledNode: path.join(root, "missing"),
    alternateBundledNode: alternate
  }), alternate);
});
