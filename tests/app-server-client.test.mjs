import assert from "node:assert/strict";
import test from "node:test";

import { AppServerClient } from "../plugins/codex-agent-team/scripts/lib/runtime/app-server.mjs";

test("CodexAgentTeam uses the platform WebSocket directly against the official loopback endpoint", async () => {
  let socketTarget;
  const socket = new FakeWebSocket((message) => {
    if (message.method === "initialize") socket.receive({ id: message.id, result: {} });
    if (message.method === "config/read") socket.receive({ id: message.id, result: { config: {} } });
  });
  const connection = new AppServerClient({
    webSocketUrl: "ws://127.0.0.1:9338/rpc",
    createWebSocketImpl: (target) => {
      socketTarget = target;
      socket.open();
      return socket;
    }
  });

  await connection.connect();
  assert.deepEqual(await connection.request("config/read"), { config: {} });
  assert.equal(socketTarget, "ws://127.0.0.1:9338/rpc");
  await connection.close();
});

test("the App Server endpoint must stay on loopback", () => {
  assert.throws(() => new AppServerClient({ webSocketUrl: "ws://example.com:9338" }), /loopback/);
  assert.throws(() => new AppServerClient({ webSocketUrl: "wss://127.0.0.1:9338" }), /ws:\/\//);
});

test("the observer never invents an answer to an App Server user request", async () => {
  const observed = [];
  const socket = new FakeWebSocket((message) => {
    observed.push(message);
    if (message.method === "initialize") socket.receive({ id: message.id, result: {} });
  });
  const connection = new AppServerClient({
    webSocketUrl: "ws://127.0.0.1:9338",
    createWebSocketImpl: () => { socket.open(); return socket; }
  });
  await connection.connect();

  socket.receive({ id: 99, method: "item/tool/requestUserInput", params: {} });
  await new Promise((resolve) => setImmediate(resolve));

  const response = observed.find(({ id }) => id === 99);
  assert.equal(response.error.code, -32601);
  assert.match(response.error.message, /does not handle server request/);
  await connection.close();
});

test("close resolves only after the transport has actually closed", async () => {
  const socket = new FakeWebSocket((message) => {
    if (message.method === "initialize") socket.receive({ id: message.id, result: {} });
  }, { automaticClose: false });
  const connection = new AppServerClient({
    webSocketUrl: "ws://127.0.0.1:9338",
    createWebSocketImpl: () => { socket.open(); return socket; }
  });
  await connection.connect();

  let closed = false;
  const closing = connection.close().then(() => { closed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  socket.finishClose();
  await closing;
  assert.equal(closed, true);
});

class FakeWebSocket {
  constructor(onMessage, { automaticClose = true } = {}) {
    this.onMessage = onMessage;
    this.automaticClose = automaticClose;
    this.readyState = 0;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  open() {
    queueMicrotask(() => {
      this.readyState = 1;
      this.#emit("open", {});
    });
  }

  send(value) {
    const message = JSON.parse(String(value));
    queueMicrotask(() => this.onMessage(message));
  }

  receive(message) {
    queueMicrotask(() => this.#emit("message", { data: JSON.stringify(message) }));
  }

  close() {
    this.readyState = 2;
    if (this.automaticClose) queueMicrotask(() => this.finishClose());
  }

  finishClose() {
    this.readyState = 3;
    this.#emit("close", {});
  }

  #emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
