import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  DesktopCdpClient,
  watchCdpEndpoint
} from "../scripts/lib/desktop-cdp.mjs";

test("CDP endpoint watchdog reports Desktop exit even when the WebSocket never closes", async () => {
  let probes = 0;
  let disconnected = 0;
  let resolveDisconnect;
  const disconnectedPromise = new Promise((resolve) => { resolveDisconnect = resolve; });
  const dispose = watchCdpEndpoint(9339, () => {
    disconnected += 1;
    resolveDisconnect();
  }, {
    intervalMs: 2,
    timeoutMs: 20,
    fetchImpl: async () => {
      probes += 1;
      if (probes === 1) return { ok: true };
      throw new Error("connection refused");
    }
  });

  await disconnectedPromise;
  await new Promise((resolve) => setTimeout(resolve, 8));
  dispose();

  assert.equal(disconnected, 1);
  assert.equal(probes, 2);
});

test("CDP connects only to the exact Codex main page target", async () => {
  let openedUrl;
  class FakeWebSocket extends EventEmitter {
    constructor(url) {
      super();
      openedUrl = url;
      queueMicrotask(() => this.emit("open"));
    }
    send(text) {
      const request = JSON.parse(text);
      queueMicrotask(() => this.emit("message", { data: JSON.stringify({ id: request.id, result: { ok: true } }) }));
    }
    close() {}
  }
  const client = await DesktopCdpClient.connect(9339, {
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return [
          { type: "page", url: "app://-/other.html", webSocketDebuggerUrl: "ws://other" },
          { type: "page", url: "app://-/index.html", webSocketDebuggerUrl: "ws://main" }
        ];
      }
    }),
    WebSocketImpl: FakeWebSocket
  });

  assert.equal(openedUrl, "ws://main");
  assert.deepEqual(await client.request("Runtime.enable"), { ok: true });
});

test("CDP reports when Codex replaces or closes its page target", async () => {
  let socket;
  class FakeWebSocket extends EventEmitter {
    constructor() {
      super();
      socket = this;
      queueMicrotask(() => this.emit("open"));
    }
    send() {}
    close() {}
  }
  const client = await DesktopCdpClient.connect(9339, {
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return [{ type: "page", url: "app://-/index.html", webSocketDebuggerUrl: "ws://main" }];
      }
    }),
    WebSocketImpl: FakeWebSocket
  });
  let disconnected = 0;
  client.onDisconnect(() => { disconnected += 1; });

  socket.emit("close");
  socket.emit("close");

  assert.equal(disconnected, 1);
});
