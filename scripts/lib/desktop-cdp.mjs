export class DesktopCdpClient {
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

  static async connect(port, { fetchImpl = fetch, WebSocketImpl = WebSocket } = {}) {
    const response = await fetchImpl(`http://127.0.0.1:${port}/json`);
    if (!response.ok) throw new Error(`CDP target discovery failed: HTTP ${response.status}`);
    const targets = await response.json();
    const exact = targets.filter((candidate) =>
      candidate?.type === "page" &&
      candidate?.url === "app://-/index.html" &&
      typeof candidate?.webSocketDebuggerUrl === "string"
    );
    if (exact.length > 1) throw new Error("Multiple Codex Desktop main CDP targets were found");
    const target = exact[0] ?? targets.find((candidate) =>
      candidate?.type === "page" &&
      typeof candidate?.url === "string" &&
      candidate.url.startsWith("app://-/") &&
      !candidate.url.includes("initialRoute=") &&
      typeof candidate?.webSocketDebuggerUrl === "string"
    );
    if (!target) throw new Error("Codex Desktop main CDP target was not found");
    const socket = new WebSocketImpl(target.webSocketDebuggerUrl);
    await waitForOpen(socket);
    return new DesktopCdpClient(socket);
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

export function watchCdpEndpoint(
  port,
  onDisconnect,
  { fetchImpl = fetch, intervalMs = 500, timeoutMs = 750 } = {}
) {
  if (!Number.isInteger(port) || port <= 0) throw new TypeError("CDP port must be a positive integer");
  if (typeof onDisconnect !== "function") throw new TypeError("onDisconnect must be a function");
  let stopped = false;
  let probing = false;
  let interval;

  const probe = async () => {
    if (stopped || probing) return;
    probing = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/json/version`, {
        signal: controller.signal
      });
      if (!response?.ok) throw new Error(`CDP endpoint returned HTTP ${response?.status ?? "unknown"}`);
    } catch (error) {
      if (!stopped) {
        stopped = true;
        clearInterval(interval);
        onDisconnect(error);
      }
    } finally {
      clearTimeout(timeout);
      probing = false;
    }
  };

  interval = setInterval(() => void probe(), intervalMs);
  void probe();
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

function waitForOpen(socket) {
  if (socket.readyState === 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const removeOpen = once(socket, "open", () => { removeError(); resolve(); });
    const removeError = once(socket, "error", (event) => { removeOpen(); reject(event?.error ?? event); });
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
