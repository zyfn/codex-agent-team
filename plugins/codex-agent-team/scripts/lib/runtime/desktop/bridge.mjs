import { loadBuiltInAvatars } from "../../manager/avatars.mjs";
import { createCodexAgentTeamManager } from "../../manager/index.mjs";
import { createTeamStore } from "../../manager/store.mjs";
import { resolveCodexCli } from "../../paths.mjs";
import {
  createCmuxTerminal,
  createGhosttyTerminal,
  createTeamTerminal
} from "../terminal.mjs";
import { CdpClient } from "./cdp.mjs";
import { buildTeamUiExpression, buildTeamUiUpdateExpression } from "./dashboard.mjs";
import { createDesktopNavigation } from "./navigation.mjs";
import { createDesktopTeams } from "./teams.mjs";

export const TEAM_BRIDGE_NAME = "codexAgentTeamBridge";

export function createDesktopBridge({
  paths,
  cdpPort,
  rpc,
  cdp: initialCdp = null,
  manager: initialManager = null,
  navigation: initialNavigation = null,
  desktopTeams: initialDesktopTeams = null,
  terminalLauncher: initialTerminalLauncher = null,
  builtInAvatars: initialBuiltInAvatars = null,
  verifyTransport = async () => {},
  onDisconnect = () => {},
  connectCdp = CdpClient.connect,
  cdpConnectTimeoutMs = 15_000,
  cdpPollMs = 100,
  rendererReadyTimeoutMs = 15_000,
  rendererPollMs = 100,
  sidebarReadyTimeoutMs = 15_000,
  sidebarPollMs = 50,
  actionTimeoutMs = 10 * 60_000,
  delay: wait = delay
}) {
  let cdp = initialCdp;
  let manager = initialManager;
  let navigation = initialNavigation;
  let desktopTeams = initialDesktopTeams;
  let terminalLauncher = initialTerminalLauncher;
  let builtInAvatars = initialBuiltInAvatars;
  let connected = false;
  let closing = false;
  let actions = Promise.resolve();
  let refreshTimer = null;
  let bootstrapScriptId = null;
  let disposeNotifications = null;
  let disposeCdpEvents = null;
  let disposeCdpDisconnect = null;

  const bridge = {
    get connected() { return connected; },
    attach,
    close,
    refresh,
    snapshot,
    whenIdle: () => actions
  };

  async function attach() {
    if (connected) return;
    let activeCdp = cdp;
    try {
      activeCdp ??= await connectWhenAvailable();
    } catch (error) {
      throw Object.assign(new Error("Codex Desktop CDP is not available", { cause: error }), {
        code: "CODEX_DESKTOP_CDP_UNAVAILABLE"
      });
    }
    try {
      const activeNavigation = navigation ?? (manager ? null : createDesktopNavigation({ cdp: activeCdp }));
      const activeDesktopTeams = desktopTeams ?? (manager ? null : createDesktopTeams({ cdp: activeCdp }));
      const store = manager ? null : (paths ? createTeamStore(paths.teamsFile) : null);
      const activeManager = manager ?? createCodexAgentTeamManager({
        store,
        rpc,
        teamsRoot: paths.teamsRoot,
        dataRoot: paths.dataRoot,
        navigation: activeNavigation,
        desktopTeams: activeDesktopTeams
      });
      const activeTerminal = terminalLauncher ?? (paths && activeManager ? createTeamTerminal({
        manager: activeManager,
        paths,
        codexCli: resolveCodexCli(),
        terminals: {
          ghostty: createGhosttyTerminal(),
          cmux: createCmuxTerminal()
        }
      }) : null);
      await Promise.all([
        waitForNavigation(activeNavigation),
        waitForNavigation(activeDesktopTeams)
      ]);
      await verifyTransport();
      cdp = activeCdp;
      manager = activeManager;
      navigation = activeNavigation;
      desktopTeams = activeDesktopTeams;
      terminalLauncher = activeTerminal;
      builtInAvatars ??= await loadBuiltInAvatars();
      await cdp.request("Runtime.enable");
      await cdp.request("Page.enable");
      await cdp.request("Runtime.addBinding", { name: TEAM_BRIDGE_NAME });
      disposeCdpEvents = cdp.onEvent((method, params) => {
        if (method === "Runtime.bindingCalled") bindingCalled(params);
        if (method === "Page.loadEventFired") scheduleRefresh();
        if (method === "Runtime.executionContextCreated" && params?.context?.auxData?.isDefault) {
          scheduleRefresh();
        }
      });
      disposeCdpDisconnect = cdp.onDisconnect?.((error) => {
        connected = false;
        if (!closing) onDisconnect(error);
      });
      disposeNotifications = rpc?.onNotification((method, params) => {
        if (/^(thread|turn|item)\//.test(method)) void refreshOwned(params);
      });
      await bootstrap();
      await manager.restoreDesktopProjection?.();
      await refresh();
      connected = true;
    } catch (error) {
      disposeNotifications?.();
      disposeNotifications = null;
      disposeCdpEvents?.();
      disposeCdpEvents = null;
      disposeCdpDisconnect?.();
      disposeCdpDisconnect = null;
      activeCdp.close?.();
      cdp = null;
      manager = null;
      navigation = null;
      desktopTeams = null;
      connected = false;
      throw error;
    }
  }

  async function connectWhenAvailable() {
    const deadline = Date.now() + Math.max(0, cdpConnectTimeoutMs);
    let lastError;
    do {
      try {
        return await connectCdp(cdpPort);
      } catch (error) {
        lastError = error;
      }
      if (Date.now() >= deadline) break;
      await wait(cdpPollMs);
    } while (Date.now() <= deadline);
    throw lastError ?? new Error("Codex Desktop CDP is not available");
  }

  async function waitForNavigation(adapter) {
    if (typeof adapter?.assertCompatible !== "function") return;
    const deadline = Date.now() + Math.max(0, rendererReadyTimeoutMs);
    for (;;) {
      try {
        return await adapter.assertCompatible();
      } catch (error) {
        if (!rendererIsStillLoading(error) || Date.now() >= deadline) throw error;
      }
      await wait(rendererPollMs);
    }
  }

  async function close() {
    closing = true;
    clearTimeout(refreshTimer);
    await actions.catch(() => undefined);
    disposeNotifications?.();
    disposeNotifications = null;
    disposeCdpEvents?.();
    disposeCdpEvents = null;
    disposeCdpDisconnect?.();
    disposeCdpDisconnect = null;
    await cdp?.evaluate("window.__codexAgentTeam?.dispose?.()").catch(() => undefined);
    if (bootstrapScriptId) {
      await cdp?.request("Page.removeScriptToEvaluateOnNewDocument", {
        identifier: bootstrapScriptId
      }).catch(() => undefined);
    }
    cdp?.close?.();
    cdp = null;
    manager = null;
    navigation = null;
    desktopTeams = null;
    bootstrapScriptId = null;
    connected = false;
    closing = false;
  }

  async function refresh(error, completeAction = false) {
    if (!manager || !cdp) throw new Error("Codex Desktop is not connected");
    if (!bootstrapScriptId) return bootstrap(error);
    const value = await buildSnapshot(error, false);
    return cdp.evaluate(buildTeamUiUpdateExpression(value, completeAction));
  }

  async function snapshot() {
    if (!manager) throw new Error("Codex Desktop is not connected");
    return manager.snapshot();
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh().catch(() => undefined), 100);
  }

  async function refreshOwned(params) {
    if (await manager?.ownsNotification(params)) scheduleRefresh();
  }

  async function bootstrap(error) {
    const value = await buildSnapshot(error, true);
    const expression = buildTeamUiExpression(value, TEAM_BRIDGE_NAME);
    if (!bootstrapScriptId) {
      const source = `;(()=>{const run=()=>{${expression}};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run,{once:true});else run();})()`;
      const result = await cdp.request("Page.addScriptToEvaluateOnNewDocument", { source });
      bootstrapScriptId = result?.identifier ?? null;
    }
    const result = await cdp.evaluate(expression);
    if (result?.installed !== false) return result;
    if (await waitForSidebar()) return { ...result, installed: true, delayed: true };
    throw Object.assign(
      new Error("This Codex Desktop build does not expose a compatible sidebar anchor"),
      { code: "CODEX_DESKTOP_UNSUPPORTED" }
    );
  }

  async function waitForSidebar() {
    const deadline = Date.now() + sidebarReadyTimeoutMs;
    while (Date.now() < deadline) {
      await wait(sidebarPollMs);
      if (await cdp.evaluate('Boolean(document.querySelector("[data-codex-agent-team-nav]"))')) return true;
    }
    return false;
  }

  async function buildSnapshot(error, includeAssets) {
    const value = {
      ...await manager.snapshot(),
      ...(includeAssets ? { builtInAvatars } : {})
    };
    return error ? { ...value, error } : value;
  }

  function bindingCalled(params) {
    if (params?.name !== TEAM_BRIDGE_NAME || typeof params?.payload !== "string") return;
    actions = actions.then(async () => {
      const action = JSON.parse(params.payload);
      let result;
      try {
        result = await withTimeout(
          dispatchAction(manager, terminalLauncher, action),
          actionTimeoutMs,
          `CodexAgentTeam ${String(action.type ?? "action")}`
        );
      } catch (error) {
        if (action.type === "inspectWorkingDirectory") {
          await cdp.evaluate(workspaceInspectionExpression(action.requestId, null, error));
          return;
        }
        throw error;
      }
      if (action.type === "inspectWorkingDirectory") {
        await cdp.evaluate(workspaceInspectionExpression(action.requestId, result));
        return;
      }
      if (action.type === "openMember") {
        await cdp.evaluate("window.__codexAgentTeam?.closePanel?.()");
      } else {
        await refresh(undefined, true);
      }
    }).catch(async (error) => {
      await refresh(error instanceof Error ? error.message : String(error), true).catch(() => undefined);
    });
  }

  return bridge;
}

async function dispatchAction(manager, terminalLauncher, action) {
  if (action.type === "openTeamTerminal") {
    if (!terminalLauncher) throw new Error("Team terminal integration is unavailable");
    await terminalLauncher.open({
      teamId: required(action.teamId, "Team id"),
      terminal: required(action.terminal, "Terminal")
    });
    return;
  }
  if (action.type === "refresh") return;
  return manager.execute(action);
}

function workspaceInspectionExpression(requestId, result, error = null) {
  const payload = {
    requestId: String(requestId ?? ""),
    ...(result ?? {}),
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  };
  return `window.__codexAgentTeam?.receiveWorkspaceInspection?.(${JSON.stringify(payload)})`;
}

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function rendererIsStillLoading(error) {
  return error?.code === "CODEX_DESKTOP_UNSUPPORTED" &&
    /renderer entry|renderer RPC module|app services did not become ready/i.test(error?.message ?? "");
}
