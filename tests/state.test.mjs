import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { requireActiveRuntime } from "../plugins/codex-agent-team/scripts/lib/runtime/state.mjs";

test("runtime consumers reject an active-looking record whose process is dead", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-runtime-state-"));
  const file = path.join(root, "runtime.json");
  await writeFile(file, JSON.stringify({
    state: "active",
    pid: 999_999_999
  }));

  await assert.rejects(
    requireActiveRuntime(file),
    /CodexAgentTeam is not running/
  );
});
