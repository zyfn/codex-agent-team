import {
  desktopCompatibilityError,
  loadDesktopAppServices,
  waitForAppServices
} from "./navigation.mjs";

export function createDesktopTeams({ cdp }) {
  if (!cdp || typeof cdp.evaluate !== "function") {
    throw new TypeError("createDesktopTeams requires a CDP client");
  }

  const loadAppServices = `()=>(${loadDesktopAppServices.toString()})(${waitForAppServices.toString()})`;

  return {
    async assertCompatible() {
      const result = await cdp.evaluate(
        `(${probeDesktopTeams.toString()})(${loadAppServices})`
      );
      if (result?.compatible !== true) {
        const missing = Array.isArray(result?.missing) ? result.missing.join(", ") : "native Projects";
        throw desktopCompatibilityError(`This Codex Desktop build is not supported: ${missing}`);
      }
      return result;
    },
    upsert({ teamId, name, teamDirectory }) {
      return cdp.evaluate(
        `(${upsertDesktopTeam.toString()})(${JSON.stringify({ teamId, name, teamDirectory })},${loadAppServices})`
      );
    },
    remove(teamId) {
      return cdp.evaluate(
        `(${removeDesktopTeam.toString()})(${JSON.stringify(teamId)},${loadAppServices})`
      );
    },
    assign({ threadId, teamId }) {
      return cdp.evaluate(
        `(${assignDesktopMember.toString()})(${JSON.stringify({ threadId, teamId })},${loadAppServices})`
      );
    },
    unassign(threadId) {
      return cdp.evaluate(
        `(${unassignDesktopMember.toString()})(${JSON.stringify(threadId)},${loadAppServices})`
      );
    }
  };
}

export async function probeDesktopTeams(loadAppServices) {
  try {
    const appServices = await loadAppServices();
    const projects = appServices?.projects;
    const missing = [];
    if (typeof projects?.upsertLocal !== "function") missing.push("projects.upsertLocal");
    if (typeof projects?.removeLocal !== "function") missing.push("projects.removeLocal");
    if (typeof appServices?.threadProjectAssignments?.setAssignment !== "function") {
      missing.push("threadProjectAssignments.setAssignment");
    }
    if (typeof appServices?.localThreadCatalog?.requestSync !== "function") {
      missing.push("localThreadCatalog.requestSync");
    }
    return { compatible: missing.length === 0, missing };
  } catch (error) {
    return { compatible: false, missing: [error instanceof Error ? error.message : String(error)] };
  }
}

export async function upsertDesktopTeam({ teamId, name, teamDirectory }, loadAppServices) {
  const projects = (await loadAppServices())?.projects;
  if (typeof projects?.upsertLocal !== "function") {
    throw new Error("Codex native local Project registration is unavailable");
  }
  await projects.upsertLocal({ projectId: teamId, name, sources: [teamDirectory] });
  return { teamId, visible: true };
}

export async function removeDesktopTeam(teamId, loadAppServices) {
  const projects = (await loadAppServices())?.projects;
  if (typeof projects?.removeLocal !== "function") {
    throw new Error("Codex native local Project removal is unavailable");
  }
  await projects.removeLocal(teamId);
  return { teamId, removed: true };
}

export async function assignDesktopMember({ threadId, teamId }, loadAppServices) {
  const appServices = await loadAppServices();
  if (typeof appServices?.threadProjectAssignments?.setAssignment !== "function") {
    throw new Error("Codex native Thread assignment is unavailable");
  }
  await appServices.threadProjectAssignments.setAssignment({
    threadId,
    assignment: { projectKind: "local", projectId: teamId }
  });
  if (typeof appServices?.localThreadCatalog?.requestSync !== "function") {
    throw new Error("Codex native Thread catalog refresh is unavailable");
  }
  await appServices.localThreadCatalog.requestSync(["local"], "immediate");
  return { threadId, teamId, assigned: true };
}

export async function unassignDesktopMember(threadId, loadAppServices) {
  const appServices = await loadAppServices();
  if (typeof appServices?.threadProjectAssignments?.setAssignment !== "function") {
    throw new Error("Codex native Thread assignment is unavailable");
  }
  await appServices.threadProjectAssignments.setAssignment({ threadId, assignment: null });
  if (typeof appServices?.localThreadCatalog?.requestSync !== "function") {
    throw new Error("Codex native Thread catalog refresh is unavailable");
  }
  await appServices.localThreadCatalog.requestSync(["local"], "immediate");
  return { threadId, assigned: false };
}
