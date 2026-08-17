import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import test from "node:test";

import { AppServerClient } from "../scripts/lib/app-server-client.mjs";

test("the runtime speaks WebSocket to the default Codex daemon Unix socket", async () => {
  const observed = [];
  let socketPath;
  class FakeSocket extends EventEmitter {
    write(chunk) {
      const bytes = Buffer.from(chunk);
      if (bytes.toString("utf8").startsWith("GET /rpc")) {
        const key = bytes.toString("utf8").match(/Sec-WebSocket-Key: ([^\r]+)/i)?.[1];
        const accept = createHash("sha1")
          .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64");
        queueMicrotask(() => this.emit("data", Buffer.from(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
        )));
        return true;
      }
      const message = decodeClientFrame(bytes);
      observed.push(message);
      if (message.id !== undefined) {
        const result = message.method === "thread/list" ? { data: [], nextCursor: null } : {};
        queueMicrotask(() => this.emit("data", encodeServerFrame({ id: message.id, result })));
      }
      return true;
    }
    end() { this.emit("close"); }
    destroy() { this.emit("close"); }
  }
  const client = new AppServerClient({
    socketPath: "/tmp/app-server-control.sock",
    createSocketImpl(path) {
      socketPath = path;
      const socket = new FakeSocket();
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    }
  });

  await client.connect();
  const listed = await client.request("thread/list", { limit: 10 });

  assert.equal(socketPath, "/tmp/app-server-control.sock");
  assert.equal(observed[0].method, "initialize");
  assert.equal(observed[1].method, "initialized");
  assert.deepEqual(listed, { data: [], nextCursor: null });
});

function decodeClientFrame(frame) {
  const masked = (frame[1] & 0x80) !== 0;
  assert.equal(masked, true);
  let length = frame[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    length = frame.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    length = Number(frame.readBigUInt64BE(2));
    offset = 10;
  }
  const mask = frame.subarray(offset, offset + 4);
  const payload = Buffer.from(frame.subarray(offset + 4, offset + 4 + length));
  for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  return JSON.parse(payload.toString("utf8"));
}

function encodeServerFrame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}
