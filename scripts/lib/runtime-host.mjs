import { buildTeamUiExpression } from "./desktop-ui.mjs";

export const TEAM_BRIDGE_NAME = "codexAgentTeamBridge";

export class RuntimeHost {
  constructor({ service, cdp, builtInAvatars = [], transportUrl = null, bindingName = TEAM_BRIDGE_NAME, onClose = () => {} }) {
    this.service = service;
    this.cdp = cdp;
    this.bindingName = bindingName;
    this.builtInAvatars = builtInAvatars;
    this.transportUrl = transportUrl;
    this.onClose = onClose;
    this.actions = Promise.resolve();
  }

  async attach() {
    await this.cdp.request("Runtime.enable");
    await this.cdp.request("Page.enable");
    await this.cdp.request("Runtime.addBinding", { name: this.bindingName });
    this.disposeEvents = this.cdp.onEvent((method, params) => {
      if (method === "Runtime.bindingCalled") this.#bindingCalled(params);
      if (method === "Page.loadEventFired") this.#scheduleRefresh();
      if (method === "Runtime.executionContextCreated" && params?.context?.auxData?.isDefault) {
        this.#scheduleRefresh();
      }
    });
    await this.refresh();
  }

  async refresh(error) {
    const snapshot = {
      ...await this.service.snapshot(),
      builtInAvatars: this.builtInAvatars,
      transportUrl: this.transportUrl
    };
    const expression = buildTeamUiExpression(
      error ? { ...snapshot, error } : snapshot,
      this.bindingName
    );
    await this.#registerBootstrap(expression);
    return this.cdp.evaluate(expression);
  }

  whenIdle() {
    return this.actions;
  }

  async close() {
    clearTimeout(this.refreshTimer);
    await this.actions.catch(() => undefined);
    this.disposeEvents?.();
    await this.cdp.evaluate("window.__codexAgentTeam?.dispose?.()").catch(() => undefined);
    if (this.bootstrapScriptId) {
      await this.cdp.request("Page.removeScriptToEvaluateOnNewDocument", {
        identifier: this.bootstrapScriptId
      }).catch(() => undefined);
      this.bootstrapScriptId = null;
    }
  }

  #scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh().catch(() => undefined), 100);
  }

  async #registerBootstrap(expression) {
    if (this.bootstrapScriptId) {
      await this.cdp.request("Page.removeScriptToEvaluateOnNewDocument", {
        identifier: this.bootstrapScriptId
      }).catch(() => undefined);
    }
    const source = `;(()=>{const run=()=>{${expression}};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run,{once:true});else run();})()`;
    const result = await this.cdp.request("Page.addScriptToEvaluateOnNewDocument", { source });
    this.bootstrapScriptId = result?.identifier ?? null;
  }

  #bindingCalled(params) {
    if (params?.name !== this.bindingName || typeof params?.payload !== "string") return;
    this.actions = this.actions.then(async () => {
      const action = JSON.parse(params.payload);
      if (action.type === "createTeam") {
        await this.service.createTeam({ name: required(action.name, "Team name") });
      } else if (action.type === "updateTeam") {
        await this.service.updateTeam(required(action.teamId, "Team id"), {
          name: required(action.name, "Team name")
        });
      } else if (action.type === "deleteTeam") {
        await this.service.deleteTeam(required(action.teamId, "Team id"));
      } else if (action.type === "createMember") {
        await this.service.createMember({
          teamId: required(action.teamId, "Team id"),
          name: required(action.name, "Member name"),
          role: String(action.role ?? "").trim(),
          projectSource: optional(action.projectSource),
          model: optional(action.model),
          reasoningEffort: optional(action.reasoningEffort),
          avatarDataUrl: optional(action.avatarDataUrl)
        });
      } else if (action.type === "updateMember") {
        await this.service.updateMember({
          teamId: required(action.teamId, "Team id"),
          memberId: required(action.memberId, "Member id"),
          name: required(action.name, "Member name"),
          role: String(action.role ?? "").trim(),
          model: optional(action.model),
          reasoningEffort: optional(action.reasoningEffort),
          avatarDataUrl: optional(action.avatarDataUrl)
        });
      } else if (action.type === "deleteMember") {
        await this.service.deleteMember(
          required(action.teamId, "Team id"),
          required(action.memberId, "Member id")
        );
      } else if (action.type === "openMember") {
        await this.service.openMember(
          required(action.teamId, "Team id"),
          required(action.memberId, "Member id")
        );
      } else if (action.type === "navigateMember") {
        await this.service.navigateMember(
          required(action.teamId, "Team id"),
          required(action.memberId, "Member id")
        );
      } else if (action.type === "closeMode") {
        await this.onClose();
      } else if (action.type !== "refresh") {
        throw new Error(`Unknown Team UI action: ${String(action.type)}`);
      }
      await this.refresh();
    }).catch(async (error) => {
      await this.refresh(error instanceof Error ? error.message : String(error)).catch(() => undefined);
    });
  }
}

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function optional(value) {
  const text = String(value ?? "").trim();
  return text || null;
}
