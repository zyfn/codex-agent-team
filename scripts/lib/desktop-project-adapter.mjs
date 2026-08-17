export class DesktopProjectAdapter {
  constructor({ cdp }) {
    if (!cdp || typeof cdp.evaluate !== "function") {
      throw new TypeError("DesktopProjectAdapter requires a CDP client");
    }
    this.cdp = cdp;
  }

  sync(teams) {
    return this.cdp.evaluate(buildProjectSyncExpression(teams));
  }

  openThread(threadId) {
    const id = requiredText(threadId, "Thread id");
    return this.cdp.evaluate(
      `(${openNativeThread.toString()})(${JSON.stringify(id)},${waitForAppServices.toString()})`
    );
  }

  removeMember(threadId) {
    const id = requiredText(threadId, "Thread id");
    return this.cdp.evaluate(
      `(${detachNativeMember.toString()})(${JSON.stringify(id)},${waitForAppServices.toString()})`
    );
  }

  removeTeam(team) {
    const projectId = requiredText(team?.projectId ?? team?.id, "Team projectId");
    const threadIds = (team?.members ?? []).map((member) => requiredText(member?.threadId, "Member threadId"));
    return this.cdp.evaluate(
      `(${removeNativeTeam.toString()})(${JSON.stringify(projectId)},${JSON.stringify(threadIds)},${waitForAppServices.toString()})`
    );
  }
}

export function buildProjectSyncExpression(teams) {
  const desired = normalizeTeams(teams);
  return `(${syncNativeProjects.toString()})(${JSON.stringify(desired)},${waitForAppServices.toString()})`;
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

function normalizeTeams(teams) {
  if (!Array.isArray(teams)) throw new TypeError("teams must be an array");
  return teams.map((team) => ({
    projectId: requiredText(team?.projectId ?? team?.id, "Team projectId"),
    name: requiredText(team?.name, "Team name"),
    cwd: requiredText(team?.cwd, "Team cwd"),
    members: (team?.members ?? []).map((member) => ({
      threadId: requiredText(member?.threadId, "Member threadId"),
      cwd: requiredText(member?.cwd, "Member cwd")
    }))
  }));
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}

async function syncNativeProjects(teams, resolveAppServices) {
  const entry = [...document.scripts].find((script) => /\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(script.src));
  if (!entry) throw new Error("Codex renderer entry module was not found");
  const entrySource = await fetch(entry.src).then((response) => {
    if (!response.ok) throw new Error(`Unable to read Codex renderer entry: ${response.status}`);
    return response.text();
  });
  const rpcReference = entrySource.match(/\.\/rpc-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!rpcReference) throw new Error("Codex renderer RPC module was not found");
  const rpcUrl = new URL(rpcReference, entry.src).href;
  const appServices = await resolveAppServices(() => import(rpcUrl));
  if (typeof appServices?.localProjects?.upsert !== "function") {
    throw new Error("Codex local Project service is unavailable");
  }
  if (typeof appServices?.threadProjectAssignments?.setAssignment !== "function") {
    throw new Error("Codex Thread assignment service is unavailable");
  }
  if (typeof appServices?.localThreadCatalog?.requestSync !== "function") {
    throw new Error("Codex local Thread catalog service is unavailable");
  }

  const bootstrap = await window.electronBridge.getInitialSidebarBootstrap();
  const entries = bootstrap?.globalStateEntries ?? {};
  const nativeProjects = new Map((entries["local-projects"] ?? []).map((project) => [project.id, project]));
  const nativeAssignments = entries["thread-project-assignments"] ?? {};
  const cache = window.__codexAgentTeamProjectSync ??= { projects: {}, assignments: {} };
  let projectsUpserted = 0;
  let assignmentsSet = 0;

  for (const team of teams) {
    const projectFingerprint = `${team.name}\u0000${team.cwd}`;
    const nativeProject = nativeProjects.get(team.projectId);
    const nativeProjectMatches = nativeProject?.name === team.name &&
      Array.isArray(nativeProject.rootPaths) &&
      nativeProject.rootPaths.length === 1 && nativeProject.rootPaths[0] === team.cwd;
    if (!nativeProjectMatches && cache.projects[team.projectId] !== projectFingerprint) {
      await appServices.localProjects.upsert({
        projectId: team.projectId,
        name: team.name,
        sources: [team.cwd]
      });
      projectsUpserted += 1;
    }
    cache.projects[team.projectId] = projectFingerprint;

    for (const member of team.members) {
      const assignmentFingerprint = `${team.projectId}\u0000${member.cwd}`;
      const nativeAssignment = nativeAssignments[member.threadId];
      const nativeAssignmentMatches = nativeAssignment?.projectKind === "local" &&
        nativeAssignment?.projectId === team.projectId && nativeAssignment?.cwd === member.cwd;
      if (!nativeAssignmentMatches && cache.assignments[member.threadId] !== assignmentFingerprint) {
        await appServices.threadProjectAssignments.setAssignment({
          threadId: member.threadId,
          assignment: {
            projectKind: "local",
            projectId: team.projectId,
            cwd: member.cwd,
            pendingCoreUpdate: false
          }
        });
        assignmentsSet += 1;
      }
      cache.assignments[member.threadId] = assignmentFingerprint;
    }
  }

  const catalogFingerprint = teams
    .flatMap((team) => team.members.map((member) => member.threadId))
    .sort()
    .join("\u0000");
  if (catalogFingerprint && cache.catalog !== catalogFingerprint) {
    await appServices.localThreadCatalog.requestSync(["local"], "immediate");
    cache.catalog = catalogFingerprint;
  }

  return { projectsUpserted, assignmentsSet };
}

async function openNativeThread(threadId, resolveAppServices) {
  const entry = [...document.scripts].find((script) => /\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(script.src));
  if (!entry) throw new Error("Codex renderer entry module was not found");
  const entrySource = await fetch(entry.src).then((response) => response.text());
  const rpcReference = entrySource.match(/\.\/rpc-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!rpcReference) throw new Error("Codex renderer RPC module was not found");
  const rpcUrl = new URL(rpcReference, entry.src).href;
  const appServices = await resolveAppServices(() => import(rpcUrl));
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

async function detachNativeMember(threadId, resolveAppServices) {
  const entry = [...document.scripts].find((script) => /\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(script.src));
  if (!entry) throw new Error("Codex renderer entry module was not found");
  const entrySource = await fetch(entry.src).then((response) => response.text());
  const rpcReference = entrySource.match(/\.\/rpc-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!rpcReference) throw new Error("Codex renderer RPC module was not found");
  const rpcUrl = new URL(rpcReference, entry.src).href;
  const appServices = await resolveAppServices(() => import(rpcUrl));
  if (typeof appServices?.threadProjectAssignments?.setAssignment !== "function") {
    throw new Error("Codex Thread assignment service is unavailable");
  }
  await appServices.threadProjectAssignments.setAssignment({ threadId, assignment: null });
  await appServices.localThreadCatalog?.requestSync?.(["local"], "immediate");
  if (window.__codexAgentTeamProjectSync?.assignments) {
    delete window.__codexAgentTeamProjectSync.assignments[threadId];
  }
  return { detached: true, threadId };
}

async function removeNativeTeam(projectId, threadIds, resolveAppServices) {
  const entry = [...document.scripts].find((script) => /\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(script.src));
  if (!entry) throw new Error("Codex renderer entry module was not found");
  const entrySource = await fetch(entry.src).then((response) => response.text());
  const rpcReference = entrySource.match(/\.\/rpc-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!rpcReference) throw new Error("Codex renderer RPC module was not found");
  const rpcUrl = new URL(rpcReference, entry.src).href;
  const appServices = await resolveAppServices(() => import(rpcUrl));
  if (typeof appServices?.localProjects?.remove !== "function") {
    throw new Error("Codex local Project removal service is unavailable");
  }
  if (typeof appServices?.threadProjectAssignments?.setAssignment !== "function") {
    throw new Error("Codex Thread assignment service is unavailable");
  }
  for (const threadId of threadIds) {
    await appServices.threadProjectAssignments.setAssignment({ threadId, assignment: null });
  }
  await appServices.localProjects.remove(projectId);
  await appServices.localThreadCatalog?.requestSync?.(["local"], "immediate");
  const cache = window.__codexAgentTeamProjectSync;
  if (cache) {
    delete cache.projects?.[projectId];
    for (const threadId of threadIds) delete cache.assignments?.[threadId];
    cache.catalog = null;
  }
  return { removed: true, projectId, detachedThreadIds: threadIds };
}
