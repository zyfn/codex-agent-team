export function createDesktopNavigation({ cdp }) {
  if (!cdp || typeof cdp.evaluate !== "function") {
    throw new TypeError("createDesktopNavigation requires a CDP client");
  }

  return {
    async assertCompatible() {
      const result = await cdp.evaluate(
        `(${probeDesktopNavigation.toString()})(${loadDesktopAppServices.toString()},${waitForAppServices.toString()})`
      );
      if (result?.compatible !== true) {
        const missing = Array.isArray(result?.missing) ? result.missing.join(", ") : "native navigation";
        throw desktopCompatibilityError(`This Codex Desktop build is not supported: ${missing}`);
      }
      return result;
    },

    openThread(threadId) {
      const id = requiredText(threadId, "Thread id");
      return cdp.evaluate(
        `(${openNativeThread.toString()})(${JSON.stringify(id)},${loadDesktopAppServices.toString()},${waitForAppServices.toString()})`
      );
    }
  };
}

export function desktopCompatibilityError(message, cause) {
  return Object.assign(new Error(message, { cause }), {
    code: "CODEX_DESKTOP_UNSUPPORTED"
  });
}

export async function waitForAppServices(loadModule, { timeoutMs = 15_000, pollMs = 50 } = {}) {
  if (typeof loadModule !== "function") throw new TypeError("loadModule must be a function");
  const rpcModule = await loadModule();
  const deadline = Date.now() + timeoutMs;
  while (rpcModule?.appServices == null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  if (rpcModule?.appServices == null) {
    throw new Error(`Codex app services did not become ready within ${timeoutMs}ms`);
  }
  return rpcModule.appServices;
}

export async function loadDesktopAppServices(waitForServices) {
  if (window.__codexAgentTeamAppServices) return window.__codexAgentTeamAppServices;
  const entry = [...document.scripts].find((script) => /\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(script.src));
  if (!entry) throw new Error("Codex renderer entry module was not found");
  const entrySource = await fetch(entry.src).then((response) => {
    if (!response.ok) throw new Error(`Unable to read Codex renderer entry: ${response.status}`);
    return response.text();
  });
  const rpcReference = entrySource.match(/\.\/rpc-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!rpcReference) throw new Error("Codex renderer RPC module was not found");
  const rpcModule = await import(new URL(rpcReference, entry.src).href);
  return window.__codexAgentTeamAppServices = await waitForServices(async () => rpcModule);
}

async function probeDesktopNavigation(loadAppServices, waitForServices) {
  try {
    const appServices = await loadAppServices(waitForServices);
    const missing = typeof appServices?.appActions?.runInPrimaryWindow === "function"
      ? []
      : ["appActions.runInPrimaryWindow"];
    return { compatible: missing.length === 0, missing };
  } catch (error) {
    return { compatible: false, missing: [error instanceof Error ? error.message : String(error)] };
  }
}

async function openNativeThread(threadId, loadAppServices, waitForServices) {
  const appServices = await loadAppServices(waitForServices);
  if (typeof appServices?.appActions?.runInPrimaryWindow !== "function") {
    throw new Error("Codex native window navigation is unavailable");
  }
  await appServices.appActions.runInPrimaryWindow({
    action: {
      kind: "codex",
      type: "windows.show_thread",
      windowId: "current",
      threadId
    },
    sourceHostId: "local"
  });
  return { navigated: true, threadId };
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}
