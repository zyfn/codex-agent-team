import assert from "node:assert/strict";
import { createConnection, createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { startDaemonRelay } from "../scripts/lib/daemon-relay.mjs";

test("the Team transport forwards bytes to the official daemon without retaining connections", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-relay-"));
  const socketPath = path.join(root, "daemon.sock");
  const daemon = createServer((socket) => socket.pipe(socket));
  await listen(daemon, socketPath);
  const relay = await startDaemonRelay({ daemonSocket: socketPath, port: 0 });

  try {
    for (let index = 0; index < 100; index += 1) {
      const response = await roundTrip(relay.port, `message-${index}`);
      assert.equal(response, `message-${index}`);
    }

    await waitFor(() => relay.getStats().activeConnections === 0);
    assert.deepEqual(relay.getStats(), {
      activeConnections: 0,
      totalConnections: 100
    });
  } finally {
    await relay.close();
    await closeServer(daemon);
    await rm(root, { recursive: true, force: true });
  }
});

test("closing the Team transport destroys open client and daemon sockets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-agent-team-relay-close-"));
  const socketPath = path.join(root, "daemon.sock");
  const daemon = createServer(() => {});
  await listen(daemon, socketPath);
  const relay = await startDaemonRelay({ daemonSocket: socketPath, port: 0 });
  const client = createConnection({ host: "127.0.0.1", port: relay.port });
  await new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });
  await waitFor(() => relay.getStats().activeConnections === 1);

  await relay.close();

  await waitFor(() => client.destroyed);
  assert.equal(relay.getStats().activeConnections, 0);
  await closeServer(daemon);
  await rm(root, { recursive: true, force: true });
});

function listen(server, target) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(target, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function roundTrip(port, text) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let result = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(text));
    socket.on("data", (chunk) => {
      result += chunk;
      if (result.length < text.length) return;
      socket.destroy();
      resolve(result);
    });
    socket.once("error", reject);
  });
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition was not met in time");
}
