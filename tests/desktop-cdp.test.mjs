import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  CdpClient
} from "../plugins/codex-agent-team/scripts/lib/runtime/desktop/cdp.mjs";

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
  const client = await CdpClient.connect(9339, {
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
  client.close();
});

test("CDP refuses to guess when the exact Codex main page target is absent", async () => {
  await assert.rejects(CdpClient.connect(9339, {
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return [{ type: "page", url: "app://-/other.html", webSocketDebuggerUrl: "ws://other" }];
      }
    }),
    WebSocketImpl: class {}
  }), /main CDP target was not found/);
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
  const client = await CdpClient.connect(9339, {
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
  client.close();
});

test("CDP target discovery and WebSocket setup are both bounded", async () => {
  await assert.rejects(CdpClient.connect(9339, {
    fetchImpl: () => new Promise(() => {}),
    WebSocketImpl: class {},
    connectTimeoutMs: 20
  }), /target discovery timed out after 20ms/);

  class NeverOpenWebSocket extends EventEmitter {
    close() { this.closed = true; }
  }
  await assert.rejects(CdpClient.connect(9339, {
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return [{ type: "page", url: "app://-/index.html", webSocketDebuggerUrl: "ws://main" }];
      }
    }),
    WebSocketImpl: NeverOpenWebSocket,
    connectTimeoutMs: 20
  }), /WebSocket connection timed out after 20ms/);
});
