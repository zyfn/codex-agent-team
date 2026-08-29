import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  connectActiveAppServer,
  disconnectActiveAppServer
} from "../plugins/codex-agent-team/scripts/lib/runtime/app-server.mjs";

test("commands connect only to the endpoint owned by the live CodexAgentTeam runtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-runtime-client-"));
  const runtimeState = path.join(root, "runtime.json");
  await writeFile(runtimeState, JSON.stringify({
    state: "active",
    pid: process.pid,
    appServerUrl: "ws://127.0.0.1:4567/"
  }));
  const calls = [];
  const client = await connectActiveAppServer({
    runtimeState,
    createConnection(options) {
      calls.push(options);
      return {
        async connect() { calls.push("connect"); },
        async request(method) { calls.push(method); return {}; },
        async close() { calls.push("close"); }
      };
    }
  });
  await disconnectActiveAppServer(client);

  assert.equal(calls[0].webSocketUrl, "ws://127.0.0.1:4567/");
  assert.deepEqual(calls.slice(1), ["connect", "config/read", "close"]);
});

test("commands retry a bounded transient loopback WebSocket handshake failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-runtime-retry-"));
  const runtimeState = path.join(root, "runtime.json");
  await writeFile(runtimeState, JSON.stringify({
    state: "active",
    pid: process.pid,
    appServerUrl: "ws://127.0.0.1:4567/"
  }));
  let attempts = 0;
  let closes = 0;
  const waits = [];
  const client = await connectActiveAppServer({
    runtimeState,
    retryDelayMs: 25,
    wait: async (milliseconds) => waits.push(milliseconds),
    createConnection() {
      attempts += 1;
      const current = attempts;
      return {
        async connect() {
          if (current < 3) {
            throw new Error("Received network error or non-101 status code. SecItemCopyMatching failed -50");
          }
        },
        async request() { return {}; },
        async close() { closes += 1; }
      };
    }
  });
  await disconnectActiveAppServer(client);

  assert.equal(attempts, 3);
  assert.equal(closes, 3);
  assert.deepEqual(waits, [25, 50]);
});
