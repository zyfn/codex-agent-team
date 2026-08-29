export class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.disconnectListeners = new Set();
    on(socket, "message", (event) => this.#receive(String(event?.data ?? event)));
    on(socket, "error", (event) => this.#fail(event?.error ?? new Error("Codex Desktop CDP error")));
    on(socket, "close", () => this.#fail(new Error("Codex Desktop CDP closed")));
  }

  static async connect(port, {
    fetchImpl = fetch,
    WebSocketImpl = WebSocket,
    connectTimeoutMs = 10_000
  } = {}) {
    const controller = new AbortController();
    const response = await withTimeout(
      fetchImpl(`http://127.0.0.1:${port}/json`, { signal: controller.signal }),
      connectTimeoutMs,
      "CDP target discovery",
      () => controller.abort()
    );
    if (!response.ok) throw new Error(`CDP target discovery failed: HTTP ${response.status}`);
    const targets = await withTimeout(
      response.json(),
      connectTimeoutMs,
      "CDP target discovery response",
      () => controller.abort()
    );
    const exact = targets.filter((candidate) =>
      candidate?.type === "page" &&
      candidate?.url === "app://-/index.html" &&
      typeof candidate?.webSocketDebuggerUrl === "string"
    );
    if (exact.length !== 1) {
      throw new Error(exact.length
        ? "Multiple Codex Desktop main CDP targets were found"
        : "Codex Desktop main CDP target was not found");
    }
    const target = exact[0];
    const socket = new WebSocketImpl(target.webSocketDebuggerUrl);
    try {
      await waitForOpen(socket, connectTimeoutMs);
    } catch (error) {
      socket.close?.();
      throw error;
    }
    return new CdpClient(socket);
  }

  request(method, params = {}, timeoutMs = 10_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.request("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (response?.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "CDP evaluation failed");
    }
    return response?.result?.value;
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onDisconnect(listener) {
    this.disconnectListeners.add(listener);
    if (this.disconnected) queueMicrotask(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  close() {
    this.socket.close();
  }

  #receive(text) {
    let message;
    try { message = JSON.parse(text); } catch { return; }
    if (typeof message?.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message?.method === "string") {
      for (const listener of this.listeners) listener(message.method, message.params);
    }
  }

  #fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (!this.disconnected) {
      this.disconnected = true;
      for (const listener of this.disconnectListeners) listener(error);
    }
  }
}

function waitForOpen(socket, timeoutMs) {
  if (socket.readyState === 1) return Promise.resolve();
  return withTimeout(new Promise((resolve, reject) => {
    const removeOpen = once(socket, "open", () => { removeError(); resolve(); });
    const removeError = once(socket, "error", (event) => { removeOpen(); reject(event?.error ?? event); });
  }), timeoutMs, "CDP WebSocket connection");
}

function withTimeout(promise, timeoutMs, label, onTimeout = () => {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function on(target, event, listener) {
  if (typeof target.addEventListener === "function") target.addEventListener(event, listener);
  else target.on(event, listener);
}

function once(target, event, listener) {
  if (typeof target.addEventListener === "function") {
    target.addEventListener(event, listener, { once: true });
    return () => target.removeEventListener(event, listener);
  }
  target.once(event, listener);
  return () => target.off(event, listener);
}
