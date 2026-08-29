import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  cleanCodexEnvironment,
  resolveCodexAppMcpConfig,
  startAppServer,
  stopAppServer
} from "../plugins/codex-agent-team/scripts/lib/runtime/app-server.mjs";

test("Team Desktop cannot inherit environment overrides that force stdio", () => {
  const env = cleanCodexEnvironment({ CODEX_HOME: "/tmp/codex-home" }, {
    PATH: "/usr/bin",
    CODEX_APP_SERVER_WS_URL: "ws://127.0.0.1:9000",
    CODEX_APP_SERVER_USE_LOCAL_DAEMON: "0",
    CODEX_APP_SERVER_FORCE_CLI: "1",
    CODEX_CLI_PATH: "/tmp/custom-codex",
    CODEX_CONFIG_DIR: "/tmp/config",
    CODEX_CI: "1",
    CODEX_PERMISSION_PROFILE: ":danger-full-access",
    CODEX_SESSION_ID: "session",
    CODEX_THREAD_ID: "thread"
  });

  assert.deepEqual(env, {
    PATH: "/usr/bin",
    CODEX_HOME: "/tmp/codex-home"
  });
});

test("official Desktop MCP config is translated without a transport field", async () => {
  const value = await resolveCodexAppMcpConfig({
    codexCli: "/Applications/Codex.app/Contents/Resources/codex",
    env: {
      CODEX_APP_TOOLS_PIPE_PATH: "/tmp/app-tools.sock",
      CODEX_MCP_NODE_PATH: "/Applications/Codex.app/Contents/Resources/cua_node/bin/node"
    },
    readFileImpl: async () => JSON.stringify({
      mcpServers: {
        codex_app: {
          command: "./scripts/launch_codex_app_tools_mcp",
          args: ["./server.mjs"],
          cwd: ".",
          enabled: true
        }
      }
    })
  });

  assert.match(value, /^mcp_servers\.codex_app=/);
  assert.match(value, /launch_codex_app_tools_mcp/);
  assert.match(value, /CODEX_APP_TOOLS_PIPE_PATH/);
  assert.doesNotMatch(value, /transport/);
});

test("one runtime starts and stops only its own official App Server process", async () => {
  const child = new EventEmitter();
  child.pid = 7000;
  child.exitCode = null;
  child.signalCode = null;
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stdin = {
    writes: [],
    write(value) { this.writes.push(value); },
    end: () => child.kill("SIGTERM")
  };
  child.kill = (signal) => {
    child.signalCode = signal;
    child.exitCode = 0;
    queueMicrotask(() => child.emit("exit", 0, signal));
  };
  const calls = [];
  const rpc = {
    async connect() { calls.push("rpc:connect"); },
    async request(method) { calls.push(`rpc:${method}`); return {}; },
    async close() { calls.push("rpc:close"); }
  };
  const appServer = await startAppServer({
    codexCli: "/opt/codex",
    codexHome: "/tmp/codex-home",
    attempts: 1,
    codexAppMcpConfig: 'mcp_servers.codex_app={"command"="/tmp/tool"}',
    allocatePort: async () => 4567,
    waitForReady: async () => {},
    createConnection: () => rpc,
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      queueMicrotask(() => child.stdout.emit("data", `${JSON.stringify({ appServerPid: 7001 })}\n`));
      return child;
    }
  });

  assert.equal(appServer.ownership, "agent-team-app-server");
  assert.equal(appServer.pid, 7001);
  assert.equal(appServer.guardianPid, 7000);
  assert.equal(appServer.url, "ws://127.0.0.1:4567");
  assert.match(calls[0].args[0], /process-guard\.mjs$/);
  assert.deepEqual(calls[0].args.slice(1), [
    "--codex", "/opt/codex",
    "--url", "ws://127.0.0.1:4567",
    "--codex-home", "/tmp/codex-home",
    "--codex-config", 'mcp_servers.codex_app={"command"="/tmp/tool"}'
  ]);
  assert.equal(calls[0].options.env.CODEX_HOME, "/tmp/codex-home");
  appServer.registerDesktop({ pid: 8123 });
  assert.deepEqual(child.stdin.writes, [`${JSON.stringify({ type: "desktop", pid: 8123 })}\n`]);
  await stopAppServer(appServer);
  assert.equal(child.signalCode, "SIGTERM");
  assert.deepEqual(calls.slice(1), ["rpc:connect", "rpc:config/read", "rpc:close"]);
});
