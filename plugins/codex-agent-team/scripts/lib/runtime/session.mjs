export async function runRuntimeSession({
  connectAppServer,
  disconnectAppServer,
  startDesktop,
  attachDesktop,
  detachDesktop,
  disposeDesktop = async () => {},
  waitForStop,
  waitForDesktopFailure = async () => new Promise(() => {}),
  requestDesktopQuit,
  terminateDesktop = (desktop) => desktop?.child?.kill?.("SIGTERM"),
  waitForDesktopExit,
  publish,
}) {
  const appServer = await connectAppServer();
  const appServerDisconnected = appServer.disconnected
    ? Promise.resolve(appServer.disconnected).then((error) => ({
        type: "app-server-disconnected",
        error,
      }))
    : new Promise(() => {});
  try {
    await publish({
      state: "opening",
      step: "connecting",
      appServerPid: appServer.pid ?? null,
      appServerGuardianPid: appServer.guardianPid ?? null,
      appServerUrl: appServer.url ?? null,
    });
    const desktop = await startDesktop(appServer);
    let cleaned = false;
    const closeDesktop = async () => {
      if (cleaned) return;
      let gracefulError = null;
      try {
        await requestDesktopQuit(desktop);
        await waitForDesktopExit(desktop);
      } catch (error) {
        gracefulError = error;
        await terminateDesktop(desktop);
        try {
          await waitForDesktopExit(desktop);
        } catch (terminateError) {
          throw new AggregateError(
            [gracefulError, terminateError],
            `CodexAgentTeam Desktop did not exit: ${readableError(gracefulError, "native quit failed")}; ${readableError(terminateError, "SIGTERM failed")}`,
          );
        }
      }
      await detachDesktop();
      await disposeDesktop(desktop);
      cleaned = true;
    };
    try {
      await publish({
        state: "opening",
        step: "attaching",
        appServerPid: appServer.pid ?? null,
        appServerGuardianPid: appServer.guardianPid ?? null,
        appServerUrl: appServer.url ?? null,
        desktopPid: desktop.pid,
        cdpPort: desktop.cdpPort ?? null,
      });
      await attachDesktop(desktop, appServer);
      await publish({
        state: "active",
        appServerPid: appServer.pid ?? null,
        appServerGuardianPid: appServer.guardianPid ?? null,
        appServerUrl: appServer.url ?? null,
        desktopPid: desktop.pid,
        cdpPort: desktop.cdpPort ?? null,
      });
      const outcome = await Promise.race([
        desktop.exited.then((detail) => ({ type: "desktop-exited", detail })),
        Promise.resolve().then(() => waitForStop()).then((reason) => ({
          type: "stop",
          reason: reason || "shutdown",
        })),
        Promise.resolve().then(() => waitForDesktopFailure(desktop)).then((reason) => ({
          type: "desktop-failure",
          reason: reason || "adapter-failed",
        })),
        appServerDisconnected,
      ]);
      if (outcome.type === "desktop-exited") {
        cleaned = true;
        await detachDesktop();
        await disposeDesktop(desktop);
        return "closed";
      }
      await closeDesktop();
      if (outcome.type === "app-server-disconnected") {
        throw new Error(readableError(
          outcome.error,
          "CodexAgentTeam App Server closed unexpectedly",
        ));
      }
      return outcome.reason;
    } catch (error) {
      try {
        await closeDesktop();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `CodexAgentTeam Desktop cleanup failed: ${readableError(error, "integration failed")}; ${readableError(cleanupError, "cleanup failed")}`,
        );
      }
      throw error;
    }
  } finally {
    await disconnectAppServer(appServer);
  }
}

function readableError(error, fallback) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || fallback;
}
