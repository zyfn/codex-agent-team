import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { requireActiveRuntime } from "./state.mjs";

const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

/** A bounded JSON-RPC client for the official Codex App Server WebSocket. */
export class AppServerClient {
  constructor({
    webSocketUrl,
    createWebSocketImpl = (url) => new WebSocket(url),
    requestTimeoutMs = 30_000,
    clientName = "codex-agent-team",
  } = {}) {
    this.webSocketUrl = validateLoopbackWebSocket(webSocketUrl);
    this.createWebSocket = createWebSocketImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.clientName = clientName;
    this.nextId = 1;
    this.pending = new Map();
    this.notificationListeners = new Set();
    this.requestListeners = new Set();
    this.incoming = Promise.resolve();
  }

  async connect() {
    if (this.socket?.readyState === OPEN && this.ready) return;
    if (this.socket)
      throw new Error("Codex App Server connection is already opening");
    const socket = this.createWebSocket(this.webSocketUrl);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      this.incoming = this.incoming
        .then(() => this.#consume(event.data))
        .catch((error) => this.#abort(error));
    });
    socket.addEventListener("error", (event) => {
      this.#fail(
        event?.error instanceof Error
          ? event.error
          : new Error("Codex App Server WebSocket failed"),
      );
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = null;
      this.ready = false;
      this.#fail(new Error("Codex App Server connection closed"));
    });

    try {
      await waitForOpen(socket, this.requestTimeoutMs);
      this.ready = true;
      await this.request("initialize", {
        clientInfo: {
          name: this.clientName,
          title: "CodexAgentTeam",
          version: "0.0.0",
        },
        capabilities: { experimentalApi: true, optOutNotificationMethods: [] },
      });
      this.notify("initialized");
    } catch (error) {
      if (this.socket === socket) this.socket = null;
      this.ready = false;
      this.#fail(error instanceof Error ? error : new Error(String(error)));
      try {
        socket.close();
      } catch {}
      throw error;
    }
  }

  request(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    if (!this.ready)
      return Promise.reject(
        new Error("Codex App Server connection is not ready"),
      );
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.#send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.#send(params === undefined ? { method } : { method, params });
  }

  onNotification(listener) {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onRequest(listener) {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  async close() {
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    this.#fail(new Error("Codex App Server connection closed"));
    if (!socket || socket.readyState === CLOSED) return;
    const closed = waitForClose(socket, 2_000);
    try {
      socket.close(1000, "CodexAgentTeam client closed");
    } catch {}
    await closed;
  }

  async #consume(data) {
    const text = await messageText(data);
    if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) {
      throw new Error("App Server WebSocket message is too large");
    }
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      throw new Error("Invalid JSON from Codex App Server", { cause: error });
    }
    this.#handle(message);
  }

  #handle(message) {
    if (
      message.id !== undefined &&
      ("result" in message || "error" in message)
    ) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(
          new Error(`${pending.method}: ${JSON.stringify(message.error)}`),
        );
      else pending.resolve(message.result);
      return;
    }
    if (message.method && message.id === undefined) {
      for (const listener of this.notificationListeners)
        listener(message.method, message.params);
      return;
    }
    if (message.method && message.id !== undefined)
      void this.#handleServerRequest(message);
  }

  async #handleServerRequest(message) {
    try {
      for (const listener of this.requestListeners) {
        const result = await listener(
          message.method,
          message.params,
          message.id,
        );
        if (result !== undefined) {
          this.#send({ id: message.id, result });
          return;
        }
      }
      this.#send({
        id: message.id,
        error: {
          code: -32601,
          message: `CodexAgentTeam does not handle server request: ${message.method}`,
        },
      });
    } catch (error) {
      if (this.ready) {
        this.#send({
          id: message.id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  #send(message) {
    if (!this.socket || !this.ready || this.socket.readyState !== OPEN) {
      throw new Error("Codex App Server connection is not ready");
    }
    this.socket.send(JSON.stringify(message));
  }

  #abort(error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    this.ready = false;
    this.#fail(failure);
    try {
      this.socket?.close(1002, "Invalid App Server message");
    } catch {}
  }

  #fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function validateLoopbackWebSocket(value) {
  if (!value) throw new TypeError("webSocketUrl is required");
  const url = new URL(value);
  if (url.protocol !== "ws:")
    throw new TypeError("Team App Server URL must use ws://");
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new TypeError("Team App Server URL must use a loopback host");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new TypeError("Team App Server URL requires a valid port");
  }
  return url.toString();
}

async function messageText(value) {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString("utf8");
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).toString("utf8");
  }
  if (typeof value?.text === "function") return value.text();
  throw new Error("Unsupported App Server WebSocket message type");
}

function waitForOpen(socket, timeoutMs) {
  if (socket.readyState === OPEN) return Promise.resolve();
  if (socket.readyState !== CONNECTING)
    return Promise.reject(
      new Error("Codex App Server WebSocket is not opening"),
    );
  return new Promise((resolve, reject) => {
    let timer;
    const opened = () => finish();
    const failed = (event) =>
      finish(
        event?.error instanceof Error
          ? event.error
          : new Error("Codex App Server WebSocket failed"),
      );
    const closed = () =>
      finish(new Error("Codex App Server WebSocket closed before opening"));
    const finish = (error) => {
      clearTimeout(timer);
      socket.removeEventListener("open", opened);
      socket.removeEventListener("error", failed);
      socket.removeEventListener("close", closed);
      if (error) reject(error);
      else resolve();
    };
    timer = setTimeout(
      () =>
        finish(
          new Error(
            `Codex App Server connection timed out after ${timeoutMs}ms`,
          ),
        ),
      timeoutMs,
    );
    timer.unref?.();
    socket.addEventListener("open", opened);
    socket.addEventListener("error", failed);
    socket.addEventListener("close", closed);
  });
}

function waitForClose(socket, timeoutMs) {
  if (socket.readyState === CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      socket.removeEventListener("close", finish);
      resolve();
    };
    timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    socket.addEventListener("close", finish);
  });
}

export async function startAppServer({
  codexCli,
  codexHome,
  nodeExecutable = process.execPath,
  guardScript = path.resolve(import.meta.dirname, "process-guard.mjs"),
  clientName = "codex-agent-team-runtime",
  attempts = 3,
  onStderr = () => {},
  spawnImpl = spawn,
  allocatePort = allocateLoopbackPort,
  waitForReady = waitForPort,
  createConnection = (options) => new AppServerClient(options),
  codexAppMcpConfig,
  resolveCodexAppConfig = resolveCodexAppMcpConfig,
}) {
  const resolvedCodexAppConfig = codexAppMcpConfig === undefined
    ? await resolveCodexAppConfig({ codexCli })
    : codexAppMcpConfig;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const port = await allocatePort();
    const url = `ws://127.0.0.1:${port}`;
    const child = spawnImpl(
      nodeExecutable,
      [
        guardScript,
        "--codex",
        codexCli,
        "--url",
        url,
        "--codex-home",
        codexHome,
        ...(resolvedCodexAppConfig ? ["--codex-config", resolvedCodexAppConfig] : []),
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: cleanCodexEnvironment({ CODEX_HOME: codexHome }),
      },
    );
    if (!Number.isInteger(child.pid) || child.pid <= 0) {
      throw new Error(
        "Official Codex App Server process identifier is unavailable",
      );
    }
    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (chunk) => onStderr(boundedLogMessage(chunk)));
    const exited = childExit(child);
    const ready = readGuardReady(child.stdout, 5_000);
    const rpc = createConnection({
      webSocketUrl: url,
      clientName,
      requestTimeoutMs: 10_000,
    });
    try {
      await Promise.race([
        Promise.all([ready, waitForReady(port, 15_000)]),
        exited.then(({ code, signal }) => {
          const detail =
            code != null ? `code ${code}` : (signal ?? "unknown reason");
          throw new Error(
            `Official Codex App Server exited before ready (${detail})`,
          );
        }),
      ]);
      const { appServerPid } = await ready;
      await rpc.connect();
      await rpc.request("config/read", {}, 10_000);
      return {
        pid: appServerPid,
        guardianPid: child.pid,
        child,
        exited,
        disconnected: exited.then(({ code, signal }) => {
          const detail =
            code != null ? `code ${code}` : (signal ?? "unknown reason");
          return new Error(`CodexAgentTeam App Server exited (${detail})`);
        }),
        rpc,
        url,
        ownership: "agent-team-app-server",
        registerDesktop({ pid }) {
          if (!Number.isInteger(pid) || pid <= 0 || child.stdin?.destroyed)
            return;
          child.stdin.write(`${JSON.stringify({ type: "desktop", pid })}\n`);
        },
      };
    } catch (error) {
      lastError = error;
      await rpc.close().catch(() => undefined);
      await stopGuard(child, exited, null, 2_000);
      await onStderr(
        `attempt ${attempt} failed: ${error?.message ?? String(error)}`,
      );
    }
  }
  throw new Error(
    `Official Codex App Server failed after ${attempts} dynamic-port attempts`,
    {
      cause: lastError,
    },
  );
}

export async function stopAppServer(appServer) {
  if (appServer?.ownership !== "agent-team-app-server") return;
  await Promise.all([
    appServer.rpc?.close().catch(() => undefined),
    stopGuard(appServer.child, appServer.exited, appServer.pid, 2_000),
  ]);
}

export async function probeAppServerCapabilities(options) {
  const probeHome = await mkdtemp(
    path.join(os.tmpdir(), "codex-agent-team-preflight-"),
  );
  let appServer = null;
  let projectId = null;
  try {
    appServer = await startAppServer({
      ...options,
      codexHome: probeHome,
      clientName: "codex-agent-team-preflight",
      attempts: 1,
    });
    await appServer.rpc.request("model/list", { limit: 1 }, 10_000);
    // A fresh CODEX_HOME may start Codex's curated-plugin sync in the
    // background. Waiting for plugin/list keeps that finite child work inside
    // the preflight App Server lifetime instead of orphaning a short git fetch.
    await appServer.rpc.request("plugin/list", {}, 20_000);
    const created = await appServer.rpc.request(
      "project/create",
      {
        name: "CodexAgentTeam compatibility probe",
        roots: [{ path: probeHome }],
        metadata: { "codex-agent-team.probe": "true" },
        idempotencyKey: `codex-agent-team:probe:${Date.now()}`,
      },
      10_000,
    );
    projectId = created?.project?.id;
    if (!projectId) throw new Error("project/create returned no Project id");
    await appServer.rpc.request(
      "project/update",
      {
        projectId,
        name: "CodexAgentTeam compatibility probe updated",
      },
      10_000,
    );
    const listed = await appServer.rpc.request(
      "project/list",
      { limit: 100 },
      10_000,
    );
    if (!(listed?.data ?? []).some((project) => project?.id === projectId)) {
      throw new Error("project/list did not return the compatibility Project");
    }
    await appServer.rpc.request("project/delete", { projectId }, 10_000);
    projectId = null;
  } catch (error) {
    throw new Error(
      "This Codex build does not expose the required Project and model capabilities",
      {
        cause: error,
      },
    );
  } finally {
    if (projectId && appServer) {
      await appServer.rpc
        .request("project/delete", { projectId }, 5_000)
        .catch(() => undefined);
    }
    if (appServer) await stopAppServer(appServer);
    await rm(probeHome, { recursive: true, force: true });
  }
}

export function cleanCodexEnvironment(overrides = {}, source = process.env) {
  const env = { ...source };
  for (const key of [
    "CODEX_APP_SERVER_WS_URL",
    "CODEX_APP_SERVER_USE_LOCAL_DAEMON",
    "CODEX_APP_SERVER_FORCE_CLI",
    "CODEX_CLI_PATH",
    "CODEX_CONFIG_DIR",
    "CODEX_CI",
    "CODEX_PERMISSION_PROFILE",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
  ])
    delete env[key];
  return { ...env, ...overrides };
}

export async function resolveCodexAppMcpConfig({
  codexCli,
  env = process.env,
  readFileImpl = readFile
}) {
  const appToolsPipe = String(env.CODEX_APP_TOOLS_PIPE_PATH ?? "").trim();
  if (!appToolsPipe) return null;
  const resourcesRoot = path.dirname(codexCli);
  const pluginRoot = path.join(
    resourcesRoot,
    "plugins",
    "openai-bundled",
    "plugins",
    "codex-app-tools"
  );
  const manifest = JSON.parse(await readFileImpl(path.join(pluginRoot, "desktop-mcp.json"), "utf8"));
  const source = manifest?.mcpServers?.codex_app;
  if (!source || typeof source.command !== "string") {
    throw new Error("Codex Desktop codex-app-tools MCP configuration is unavailable");
  }
  const config = {
    ...source,
    command: path.resolve(pluginRoot, source.command),
    cwd: path.resolve(pluginRoot, source.cwd ?? "."),
    enabled: true,
    omit_tools_from: ["deferred", "code_mode"],
    env: {
      ...(source.env ?? {}),
      CODEX_APP_TOOLS_PIPE_PATH: appToolsPipe,
      ...(env.CODEX_MCP_NODE_PATH
        ? { CODEX_MCP_NODE_PATH: env.CODEX_MCP_NODE_PATH }
        : {})
    }
  };
  return `mcp_servers.codex_app=${tomlInline(config)}`;
}

function tomlInline(value) {
  if (Array.isArray(value)) return `[${value.map(tomlInline).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => `${JSON.stringify(key)}=${tomlInline(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function allocateLoopbackPort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (Number.isInteger(port)) resolve(port);
        else reject(new Error("Unable to allocate a loopback port"));
      });
    });
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) return;
    await delay(50);
  }
  throw new Error("Official App Server did not become ready");
}

function childExit(child) {
  if (child.exitCode !== null)
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function stopGuard(child, exited, appServerPid, graceMs) {
  if (child && child.exitCode === null) {
    child.stdin?.end?.();
    const stopped = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), graceMs);
      Promise.resolve(exited).then(
        () => finish(true),
        () => finish(true),
      );
    });
    if (!stopped && child.exitCode === null) {
      child.kill("SIGTERM");
      const terminated = await Promise.race([
        Promise.resolve(exited).then(
          () => true,
          () => true,
        ),
        delay(1_000).then(() => false),
      ]);
      if (!terminated && child.exitCode === null) child.kill("SIGKILL");
      await Promise.resolve(exited).catch(() => undefined);
    }
  }
  if (Number.isInteger(appServerPid) && processAlive(appServerPid)) {
    try {
      process.kill(appServerPid, "SIGTERM");
    } catch {}
    const deadline = Date.now() + 1_000;
    while (processAlive(appServerPid) && Date.now() < deadline) await delay(20);
    if (processAlive(appServerPid)) {
      try {
        process.kill(appServerPid, "SIGKILL");
      } catch {}
    }
  }
}

function readGuardReady(stream, timeoutMs) {
  if (!stream)
    return Promise.reject(
      new Error("CodexAgentTeam App Server guardian has no stdout"),
    );
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off?.("data", onData);
      stream.off?.("error", onError);
      stream.off?.("close", onClose);
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      buffer += String(chunk);
      if (buffer.length > 64 * 1024)
        return finish(
          null,
          new Error("CodexAgentTeam App Server guardian output is too large"),
        );
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const value = JSON.parse(buffer.slice(0, newline));
        if (!Number.isInteger(value?.appServerPid) || value.appServerPid <= 0) {
          throw new Error(
            "CodexAgentTeam App Server guardian returned no process identifier",
          );
        }
        finish(value);
      } catch (error) {
        finish(null, error);
      }
    };
    const onError = (error) => finish(null, error);
    const onClose = () =>
      finish(
        null,
        new Error("CodexAgentTeam App Server guardian closed before ready"),
      );
    const timer = setTimeout(
      () => finish(null, new Error("CodexAgentTeam App Server guardian timed out")),
      timeoutMs,
    );
    timer.unref?.();
    stream.setEncoding?.("utf8");
    stream.on("data", onData);
    stream.once("error", onError);
    stream.once("close", onClose);
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boundedLogMessage(value, limit = 16 * 1024) {
  const text = String(value).trimEnd();
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated]`;
}

export async function connectActiveAppServer({
  runtimeState,
  clientName = "codex-agent-team-command",
  createConnection = (options) => new AppServerClient(options),
}) {
  const runtime = await requireActiveRuntime(runtimeState);
  if (!runtime.appServerUrl)
    throw new Error("CodexAgentTeam App Server endpoint is unavailable");
  const rpc = createConnection({
    webSocketUrl: runtime.appServerUrl,
    clientName,
  });
  try {
    await rpc.connect();
    await rpc.request("config/read", {}, 10_000);
  } catch (error) {
    await rpc.close?.().catch(() => undefined);
    throw error;
  }
  return { runtime, rpc };
}

export async function disconnectActiveAppServer(client) {
  await client?.rpc?.close?.();
}
