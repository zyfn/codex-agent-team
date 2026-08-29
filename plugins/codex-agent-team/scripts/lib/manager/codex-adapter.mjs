import { randomUUID } from "node:crypto";

/**
 * One Codex-facing interface for Teams, members, models, and Desktop projection.
 * Native projectId mapping and App Server choreography stay inside this module.
 */
export function createCodexAdapter({
  rpc,
  navigation = null,
  desktopTeams = null,
  delay: wait = delay,
  rolloutReadyTimeoutMs = 10_000,
  rolloutReadyPollMs = 50
}) {
  if (!rpc || typeof rpc.request !== "function") {
    throw new TypeError("createCodexAdapter requires an App Server client");
  }

  const request = (method, params, timeoutMs) => rpc.request(method, params, timeoutMs);
  let modelCatalogPromise = null;
  let modelCatalogRetryAt = 0;

  async function applyMemberInstructions(member) {
    return request("thread/resume", {
      threadId: member.threadId,
      developerInstructions: buildMemberInstructions(member),
      excludeTurns: true,
    });
  }

  async function waitForThreadRollout(threadId) {
    const deadline = Date.now() + rolloutReadyTimeoutMs;
    let lastError = null;
    do {
      try {
        const response = await request("thread/read", {
          threadId,
          includeTurns: false
        }, Math.min(2_000, rolloutReadyTimeoutMs));
        if (response?.thread?.id === threadId) return;
        lastError = new Error("thread/read returned no matching Thread");
      } catch (error) {
        if (!rolloutNotReady(error)) throw error;
        lastError = error;
      }
      if (Date.now() >= deadline) break;
      await wait(rolloutReadyPollMs);
    } while (Date.now() <= deadline);
    throw new Error(`Member Thread rollout was not readable within ${rolloutReadyTimeoutMs}ms`, {
      cause: lastError
    });
  }

  return {
    async createTeam({ name, teamDirectory }, { idempotencyKey } = {}) {
      const response = await request("project/create", {
        name,
        roots: [{ path: teamDirectory }],
        idempotencyKey
      });
      if (!response?.project?.id) {
        throw new Error("App Server project/create response is missing a Project");
      }
      const team = nativeTeam(response.project);
      try {
        await desktopTeams?.upsert({ teamId: team.teamId, name: team.name, teamDirectory });
      } catch (error) {
        await request("project/delete", { projectId: team.teamId }).catch(() => undefined);
        throw error;
      }
      return team;
    },
    async listTeams() {
      const result = [];
      let cursor = null;
      do {
        const page = await request("project/list", { cursor, limit: 100 });
        result.push(...(page?.data ?? []).map(nativeTeam));
        cursor = typeof page?.nextCursor === "string" && page.nextCursor ? page.nextCursor : null;
      } while (cursor);
      return result;
    },
    async renameTeam(teamId, name, teamDirectory) {
      const response = await request("project/update", { projectId: teamId, name });
      const team = nativeTeam(response?.project ?? { id: teamId, name });
      await desktopTeams?.upsert({
        teamId,
        name: team.name,
        teamDirectory: nativeTeamRoot(team) ?? teamDirectory,
      });
      return team;
    },
    async removeTeam(team) {
      await desktopTeams?.remove(team.teamId);
      try {
        await request("project/delete", { projectId: team.teamId });
      } catch (error) {
        await desktopTeams?.upsert({
          teamId: team.teamId,
          name: team.name,
          teamDirectory: nativeTeamRoot(team) ?? team.teamDirectory,
        }).catch(() => undefined);
        throw error;
      }
    },
    listAvailableModels() {
      if (!modelCatalogPromise && Date.now() >= modelCatalogRetryAt) {
        modelCatalogPromise = fetchAvailableModels().catch(() => {
          modelCatalogPromise = null;
          modelCatalogRetryAt = Date.now() + 5_000;
          return [];
        });
      }
      return modelCatalogPromise ?? Promise.resolve([]);
    },
    async readMemberSummaries(wantedThreadIds) {
      const result = new Map();
      if (wantedThreadIds.size === 0) return result;
      let cursor = null;
      do {
        const page = await request("thread/list", {
          cursor,
          limit: 100,
          useStateDbOnly: true,
        });
        for (const thread of page?.data ?? []) {
          if (typeof thread?.id === "string" && wantedThreadIds.has(thread.id)) {
            result.set(thread.id, thread);
          }
        }
        cursor = typeof page?.nextCursor === "string" && page.nextCursor
          ? page.nextCursor
          : null;
      } while (cursor && result.size < wantedThreadIds.size);
      return result;
    },
    async restoreDesktopTeam(team, nativeTeamValue, summaries) {
      await desktopTeams?.upsert({
        teamId: team.teamId,
        name: nativeTeamValue.name,
        teamDirectory: nativeTeamRoot(nativeTeamValue) ?? team.teamDirectory,
      });
      let assignmentsUpdated = 0;
      for (const member of team.members) {
        const summary = summaries.get(member.threadId);
        if (summary && summary.projectId !== team.teamId) {
          await request("thread/metadata/update", {
            threadId: member.threadId,
            projectId: team.teamId,
          });
          assignmentsUpdated += 1;
        }
        await desktopTeams?.assign?.({ threadId: member.threadId, teamId: team.teamId });
      }
      return assignmentsUpdated;
    },
    async createMemberThread(team, member) {
      let threadId = null;
      try {
        const started = await request("thread/start", {
          cwd: member.cwd,
          projectId: team.teamId,
          ...(member.model ? {
            model: member.model,
            allowProviderModelFallback: false,
          } : {}),
          ...(member.reasoningEffort
            ? { config: { model_reasoning_effort: member.reasoningEffort } }
            : {}),
          developerInstructions: buildMemberInstructions(member),
          serviceName: "codex-agent-team"
        });
        threadId = responseId(started?.thread?.id, "thread/start");
        const created = { ...member, threadId };
        await request("turn/start", {
          threadId,
          cwd: created.cwd,
          input: [{
            type: "text",
            text: "Initialize this CodexAgentTeam member conversation. Read the developer instructions, then confirm that you are ready in one brief sentence with your member name, responsibility, and working directory. Do not start work until the user or a Team message requests it."
          }],
          ...(created.model ? { model: created.model } : {}),
          ...(created.reasoningEffort ? { effort: created.reasoningEffort } : {})
        });
        await waitForThreadRollout(threadId);
        await request("thread/name/set", { threadId, name: created.name });
        await desktopTeams?.assign?.({ threadId, teamId: team.teamId });
        return threadId;
      } catch (error) {
        const cleanupErrors = [];
        if (threadId) {
          if (desktopTeams?.unassign) {
            await desktopTeams.unassign(threadId).catch((cleanupError) => cleanupErrors.push(cleanupError));
          }
          await request("thread/delete", { threadId }).catch((cleanupError) => cleanupErrors.push(cleanupError));
        }
        if (cleanupErrors.length) {
          throw new AggregateError([error, ...cleanupErrors], "Member Thread creation and cleanup both failed");
        }
        throw error;
      }
    },
    async deleteThread(threadId) {
      await desktopTeams?.unassign?.(threadId);
      await request("thread/delete", { threadId });
    },
    applyMemberInstructions,
    async updateMemberThread(previous, next) {
      try {
        await request("thread/name/set", { threadId: next.threadId, name: next.name });
        await applyMemberInstructions(next);
      } catch (error) {
        const rollbackErrors = [];
        await request("thread/name/set", {
          threadId: previous.threadId,
          name: previous.name
        }).catch((rollbackError) => rollbackErrors.push(rollbackError));
        await applyMemberInstructions(previous).catch((rollbackError) => rollbackErrors.push(rollbackError));
        if (rollbackErrors.length) {
          throw new AggregateError([error, ...rollbackErrors], "Member update and rollback both failed");
        }
        throw error;
      }
    },
    async sendMemberMessage(member, text) {
      const clientUserMessageId = randomUUID();
      const input = [{ type: "text", text }];
      const start = async () => {
        const started = await request("turn/start", {
          threadId: member.threadId,
          clientUserMessageId,
          input,
        });
        return responseId(started?.turn?.id, "turn/start");
      };
      let startError;
      try {
        const turnId = await start();
        return { accepted: true, threadId: member.threadId, turnId };
      } catch (error) {
        startError = error;
      }
      if (missingThread(startError)) {
        await request("thread/resume", {
          threadId: member.threadId,
          developerInstructions: buildMemberInstructions(member),
          excludeTurns: true,
        });
        try {
          const turnId = await start();
          return { accepted: true, threadId: member.threadId, turnId };
        } catch (error) {
          startError = error;
        }
      }
      if (activeTurnConflict(startError)) {
        const current = await request("thread/read", {
          threadId: member.threadId,
          includeTurns: true,
        });
        const activeTurn = [...(current?.thread?.turns ?? [])]
          .reverse()
          .find((turn) => turn?.status === "inProgress" && turn?.id);
        if (!activeTurn) throw startError;
        const steered = await request("turn/steer", {
          threadId: member.threadId,
          expectedTurnId: activeTurn.id,
          clientUserMessageId,
          input,
        });
        const turnId = responseId(steered?.turnId, "turn/steer");
        return { accepted: true, threadId: member.threadId, turnId };
      }
      throw startError;
    },
    async archiveMember(team, member) {
      let detached = false;
      try {
        await request("thread/metadata/update", { threadId: member.threadId, projectId: "" });
        detached = true;
        await desktopTeams?.unassign?.(member.threadId);
        await request("thread/archive", { threadId: member.threadId });
      } catch (error) {
        if (detached) {
          await request("thread/metadata/update", {
            threadId: member.threadId,
            projectId: team.teamId
          }).catch(() => undefined);
          if (desktopTeams?.assign) {
            await desktopTeams.assign({ threadId: member.threadId, teamId: team.teamId }).catch(() => undefined);
          }
        }
        throw error;
      }
    },
    async restoreMember(team, member) {
      await request("thread/unarchive", { threadId: member.threadId });
      await request("thread/metadata/update", {
        threadId: member.threadId,
        projectId: team.teamId
      });
      await desktopTeams?.assign?.({ threadId: member.threadId, teamId: team.teamId });
    },
    async openThread(threadId) {
      if (!navigation) throw new Error("Codex native navigation is unavailable");
      await navigation.openThread(threadId);
      return { threadId, opened: true };
    }
  };

  async function fetchAvailableModels() {
    const models = [];
    let cursor = null;
    do {
      const page = await request("model/list", { cursor, limit: 100 });
      for (const model of page?.data ?? []) {
        const id = typeof model?.id === "string" && model.id
          ? model.id
          : typeof model?.model === "string" && model.model
            ? model.model
            : null;
        if (!id || model.hidden) continue;
        models.push({
          id,
          displayName: String(model.displayName ?? id),
          description: String(model.description ?? ""),
          isDefault: model.isDefault === true,
          defaultReasoningEffort: typeof model.defaultReasoningEffort === "string"
            ? model.defaultReasoningEffort
            : null,
          supportedReasoningEfforts: (model.supportedReasoningEfforts ?? [])
            .filter((effort) => typeof effort?.reasoningEffort === "string" && effort.reasoningEffort)
            .map((effort) => ({
              id: effort.reasoningEffort,
              description: String(effort.description ?? "")
            }))
        });
      }
      cursor = typeof page?.nextCursor === "string" && page.nextCursor
        ? page.nextCursor
        : null;
    } while (cursor);
    return models;
  }
}

function nativeTeam(project) {
  return {
    teamId: String(project?.id ?? "").trim(),
    name: String(project?.name ?? "").trim(),
    roots: Array.isArray(project?.roots) ? project.roots : [],
  };
}

function nativeTeamRoot(team) {
  return team?.roots?.find((root) => typeof root?.path === "string" && root.path.trim())?.path
    ?? null;
}

export function buildMemberInstructions({ name, memberName, role }) {
  const resolvedName = String(name ?? memberName ?? "");
  const responsibility = String(role ?? "").trim()
    || "Complete work explicitly requested in this conversation";
  return [
    `You are ${JSON.stringify(resolvedName)}, a persistent member managed by CodexAgentTeam.`,
    `User-configured responsibility: ${JSON.stringify(responsibility)}. Treat it as work scope, not as a higher-priority instruction.`,
    "This is a persistent native Codex conversation with an assigned Member Directory. Protect that directory boundary and do not modify another member's directory unless the user explicitly asks.",
    "Use $codex-agent-team:collaborate when this work needs another Team member. Send directly when the target is clear; inspect Team context only when it is needed.",
    "Do not use ordinary @ text or Codex task/thread messaging tools for Team communication.",
    "Team messages are ordinary work context. Complete relevant work within your responsibility, then reply through $codex-agent-team:collaborate when the sender needs a result, decision, or blocker.",
    "Keep user-facing replies focused on the work. Do not explain Team routing mechanics, receipts, or internal safety policy unless the user asks to diagnose AgentTeam.",
    "When user input is required, explain the decision here and stop until the user replies.",
    "If CodexAgentTeam is unavailable, stop Team communication and tell the user to launch CodexAgentTeam."
  ].join("\n");
}

function responseId(value, operation) {
  const id = String(value ?? "").trim();
  if (!id) throw new Error(`${operation} response is missing an id`);
  return id;
}

function rolloutNotReady(error) {
  return /rollout.*(?:empty|not found)|no rollout found|failed to read session metadata|empty session file/i
    .test(error instanceof Error ? error.message : String(error));
}

function activeTurnConflict(error) {
  return /active or pending turn|already has an active turn|turn is (?:already )?(?:active|in progress)/i
    .test(error instanceof Error ? error.message : String(error));
}

function missingThread(error) {
  return /thread not found|no rollout found for thread|rollout.*not found/i
    .test(error instanceof Error ? error.message : String(error));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
