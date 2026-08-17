import { createHash, randomBytes } from "node:crypto";
import { createConnection } from "node:net";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export class AppServerClient {
  constructor({
    socketPath,
    createSocketImpl = (target) => createConnection(target),
    requestTimeoutMs = 30_000
  } = {}) {
    this.socketPath = socketPath;
    this.createSocketImpl = createSocketImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
  }

  async connect() {
    if (this.socket) return;
    if (!this.socketPath) throw new Error("App Server daemon socket path is required");
    const socket = this.createSocketImpl(this.socketPath);
    this.socket = socket;
    socket.on("data", (chunk) => this.#consume(Buffer.from(chunk)));
    socket.on("error", (error) => this.#failAll(error));
    socket.on("close", () => {
      this.socket = undefined;
      this.#failAll(new Error("Codex App Server daemon connection closed"));
    });
    await waitForConnect(socket);
    await this.#handshake();
    await this.request("initialize", {
      clientInfo: {
        name: "codex-agent-team",
        title: "Codex Agent Team",
        version: "0.1.0"
      },
      capabilities: { experimentalApi: true, optOutNotificationMethods: [] }
    });
    this.notify("initialized");
  }

  request(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    if (!this.ready) return Promise.reject(new Error("App Server client is not connected"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.#sendJson({ id, method, params });
    });
  }

  notify(method, params) {
    const message = params === undefined ? { method } : { method, params };
    this.#sendJson(message);
  }

  onNotification(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    const socket = this.socket;
    this.socket = undefined;
    this.ready = false;
    if (!socket) return;
    try { socket.write(encodeFrame(Buffer.alloc(0), 0x8)); } catch {}
    socket.end?.();
  }

  async #handshake() {
    const key = randomBytes(16).toString("base64");
    const expectedAccept = createHash("sha1").update(`${key}${WEBSOCKET_GUID}`).digest("base64");
    const response = new Promise((resolve, reject) => {
      this.handshake = { expectedAccept, resolve, reject };
    });
    this.socket.write([
      "GET /rpc HTTP/1.1",
      "Host: localhost",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n"));
    await response;
    this.ready = true;
  }

  #sendJson(message) {
    if (!this.socket || !this.ready) throw new Error("App Server client is not connected");
    this.socket.write(encodeFrame(Buffer.from(JSON.stringify(message)), 0x1));
  }

  #consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.handshake) {
      const marker = this.buffer.indexOf("\r\n\r\n");
      if (marker < 0) return;
      const header = this.buffer.subarray(0, marker).toString("utf8");
      this.buffer = this.buffer.subarray(marker + 4);
      const status = header.split("\r\n", 1)[0];
      const accept = header.match(/^Sec-WebSocket-Accept:\s*(.+)$/im)?.[1]?.trim();
      const pending = this.handshake;
      this.handshake = undefined;
      if (!/^HTTP\/1\.1 101\b/.test(status) || accept !== pending.expectedAccept) {
        pending.reject(new Error(`App Server WebSocket handshake failed: ${status}`));
        return;
      }
      pending.resolve();
    }
    this.#consumeFrames();
  }

  #consumeFrames() {
    for (;;) {
      const parsed = decodeFrame(this.buffer);
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.bytesConsumed);
      if (parsed.opcode === 0x8) {
        this.#failAll(new Error("App Server closed the WebSocket"));
        this.socket?.end?.();
        return;
      }
      if (parsed.opcode === 0x9) {
        this.socket?.write(encodeFrame(parsed.payload, 0xA));
        continue;
      }
      if (parsed.opcode === 0xA) continue;
      if (parsed.opcode === 0x1) this.fragments = [parsed.payload];
      else if (parsed.opcode === 0x0) this.fragments.push(parsed.payload);
      else continue;
      if (!parsed.fin) continue;
      const payload = Buffer.concat(this.fragments);
      this.fragments = [];
      try {
        this.#handle(JSON.parse(payload.toString("utf8")));
      } catch (error) {
        this.#failAll(new Error("Invalid JSON from Codex App Server", { cause: error }));
      }
    }
  }

  #handle(message) {
    if (message.id !== undefined && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method && message.id === undefined) {
      for (const listener of this.listeners) listener(message.method, message.params);
      return;
    }
    if (message.method && message.id !== undefined) {
      this.#sendJson({ id: message.id, error: { code: -32601, message: `Unsupported server request: ${message.method}` } });
    }
  }

  #failAll(error) {
    this.handshake?.reject(error);
    this.handshake = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function encodeFrame(payload, opcode) {
  const mask = randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index] ^ mask[index % 4];
  return Buffer.concat([header, mask, masked]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const fin = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const wide = buffer.readBigUInt64BE(2);
    if (wide > BigInt(MAX_FRAME_BYTES)) throw new Error("App Server WebSocket frame is too large");
    length = Number(wide);
    offset = 10;
  }
  if (length > MAX_FRAME_BYTES) throw new Error("App Server WebSocket frame is too large");
  const maskOffset = masked ? 4 : 0;
  if (buffer.length < offset + maskOffset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset + maskOffset, offset + maskOffset + length));
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }
  return { fin, opcode, payload, bytesConsumed: offset + maskOffset + length };
}

function waitForConnect(socket) {
  if (socket.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onConnect = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}
