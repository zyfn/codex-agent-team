import { TEAM_UI_STYLES } from "./styles.mjs";

export function buildTeamUiExpression(snapshot, bindingName) {
  return `;(${installTeamUi.toString()})(${JSON.stringify(snapshot)}, ${JSON.stringify(bindingName)}, (${findNativeTopNavigationItem.toString()}), ${JSON.stringify(TEAM_UI_STYLES)}, (${chooseNativeDirectory.toString()}))`;
}

export function buildTeamUiUpdateExpression(snapshot, completeAction = false) {
  return `;window.__codexAgentTeam?.update?.(${JSON.stringify(snapshot)},${JSON.stringify(completeAction)})`;
}

export function findNativeTopNavigationItem(document, labels = ["Plugins", "插件"]) {
  const routeMatches = Array.from(document.querySelectorAll('a[href]'))
    .filter((node) => {
      const href = node.getAttribute?.("href") ?? "";
      return href === "/skills" || href.startsWith("/skills?") || href.startsWith("/skills#");
    });
  if (routeMatches.length === 1) return routeMatches[0];
  if (routeMatches.length > 1) return null;
  const matches = Array.from(document.querySelectorAll("span,div,p,a,button"))
    .filter((node) => !node.children.length && labels.includes(node.textContent?.trim()))
    .map((node) => node.closest("button,a,[role=button]"))
    .filter(Boolean);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}

export function chooseNativeDirectory(hostWindow, { timeoutMs = 120_000 } = {}) {
  const bridge = hostWindow?.electronBridge;
  if (typeof bridge?.sendMessageFromView !== "function") {
    return Promise.reject(new Error("Codex native directory picker is unavailable"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (result, error = null) => {
      if (settled) return;
      settled = true;
      hostWindow.removeEventListener("message", onMessage);
      if (timer !== null) hostWindow.clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const onMessage = (event) => {
      const message = event?.data;
      if (!message || typeof message !== "object") return;
      if (message.type === "workspace-root-option-picked") {
        finish(String(message.root ?? "").trim() || null);
      } else if (message.type === "workspace-root-option-add-canceled") {
        finish(null);
      }
    };
    hostWindow.addEventListener("message", onMessage);
    timer = hostWindow.setTimeout(() => {
      finish(null, new Error("Codex native directory picker timed out"));
    }, timeoutMs);
    Promise.resolve(bridge.sendMessageFromView({
      type: "electron-pick-workspace-root-option",
      allowMultiple: false
    })).catch((error) => finish(null, error));
  });
}

function installTeamUi(snapshot, bindingName, findNativeTopNavigationItem, styles, chooseNativeDirectory) {
  const state = window.__codexAgentTeam ??= {};
  if (state.uiRevision !== "top-navigation-v4") state.dispose?.();
  state.uiRevision = "top-navigation-v4";
  state.snapshot = snapshot;
  state.bindingName = bindingName;
  state.expandedTeamIds ??= new Set((snapshot.teams ?? []).map((team) => team.teamId));

  const clientLocale = () => document.documentElement.lang
    || navigator.languages?.[0]
    || navigator.language
    || "en";
  const language = () => /^zh(?:-|$)/i.test(clientLocale()) ? "zh" : "en";
  const messages = {
    en: {
      teams: "Teams", manage: "Manage", panelLabel: "CodexAgentTeam management",
      connected: "Connected", disconnected: "Disconnected", teamCountOne: "{count} team", teamCount: "{count} teams",
      running: "Running", waiting: "Needs attention", idle: "Idle", offline: "Offline", error: "Error",
      newTeam: "New Team", back: "Back",
      expandAll: "Expand All", collapseAll: "Collapse All", addMember: "Add Member",
      openCli: "Open CLI", openGhostty: "Open in Ghostty", openCmux: "Open in cmux",
      editTeam: "Edit Team", removeTeam: "Remove Team", noRole: "No role set",
      edit: "Edit", removeMember: "Remove Member", noMembers: "No members yet",
      noTeams: "No teams yet", noTeamsDescription: "Create a team, then add members with their own native Codex conversations.",
      removeTeamTitle: "Remove “{name}”?", removeTeamDescription: "Native member conversations and Team directories will be preserved.",
      removeMemberTitle: "Remove “{name}”?", removeMemberDescription: "The native conversation is archived. All Member Directory files and Git branches are preserved.",
      cancel: "Cancel", createTeam: "Create Team", teamName: "Team name", save: "Save", create: "Create",
      editTeamDescription: "Renames this Team in Codex without reopening member conversations.",
      createTeamDescription: "Start with a name. Add members and working directories when you need them.",
      editMember: "Edit Member", addToTeam: "Add to {name}",
      editMemberDescription: "Updates this native conversation. Its existing Member Directory is preserved.",
      createMemberDescription: "Creates a persistent native Codex conversation in an empty Member Directory, a local Git worktree, or a remote Git clone.",
      memberName: "Member name", role: "Role", avatar: "Avatar", builtInAvatars: "Built-in", customAvatar: "Custom",
      chooseImage: "Choose Image", currentImage: "Current image", noImage: "No image selected",
      gitSource: "Git repository (optional)", chooseLocalGit: "Choose Local Git", noGitSource: "No local repository selected",
      noLocalGit: "Using remote repository", remoteGitUrl: "Remote Git URL", remoteGitPlaceholder: "https://github.com/org/repo.git",
      choosingFolder: "Choosing…", checkingFolder: "Checking Git repository…", directoryReadFailed: "Could not read the selected folder",
      gitRequired: "The selected folder is not a Git repository.", localWorktreeHint: "Creates an isolated Git worktree in the Member Directory.",
      remoteCloneHint: "Clones the remote repository into the Member Directory.", emptyMemberDirectoryHint: "Creates an empty Member Directory.",
      finalWorkingDirectory: "Working directory: {path}", memberDirectoryPlaceholder: "<member name>",
      model: "Model", reasoning: "Reasoning effort",
      codexDefault: "Codex default", modelDefault: "Model default ({effort})", defaultOption: "Default",
      createMember: "Create Member", preparingMember: "Preparing Member Directory and conversation…", savingMember: "Saving…", dismissError: "Dismiss",
      avatarTooLarge: "Choose an image smaller than 2 MB",
      avatarUnsupported: "Choose a PNG, JPEG, WebP, or GIF image"
    },
    zh: {
      teams: "团队", manage: "管理", panelLabel: "CodexAgentTeam 管理",
      connected: "已连接", disconnected: "未连接", teamCountOne: "{count} 个团队", teamCount: "{count} 个团队",
      running: "运行中", waiting: "等待操作", idle: "空闲", offline: "离线", error: "异常",
      newTeam: "创建团队", back: "返回",
      expandAll: "全部展开", collapseAll: "全部收起", addMember: "添加成员",
      openCli: "打开 CLI", openGhostty: "在 Ghostty 中打开", openCmux: "在 cmux 中打开",
      editTeam: "编辑团队", removeTeam: "移除团队", noRole: "未设置职责",
      edit: "编辑", removeMember: "移除成员", noMembers: "暂无成员",
      noTeams: "还没有团队", noTeamsDescription: "创建团队后，再添加拥有独立原生会话的成员。",
      removeTeamTitle: "移除「{name}」？", removeTeamDescription: "成员原生会话和 Team 目录都会保留。",
      removeMemberTitle: "移除成员「{name}」？", removeMemberDescription: "原生会话将被归档；成员目录文件和 Git 分支都会保留。",
      cancel: "取消", createTeam: "创建团队", teamName: "团队名称", save: "保存", create: "创建",
      editTeamDescription: "在 Codex 中重命名该团队，不会重新加载成员会话。",
      createTeamDescription: "只需一个名称；成员和工作目录可以稍后添加。",
      editMember: "编辑成员", addToTeam: "添加到 {name}",
      editMemberDescription: "更新这位成员的原生会话；已有成员目录保持不变。",
      createMemberDescription: "在空成员目录、本地 Git worktree 或远程 Git clone 中创建持久原生 Codex 会话。",
      memberName: "成员名称", role: "职责", avatar: "头像", builtInAvatars: "内置头像", customAvatar: "自定义",
      chooseImage: "选择图片", currentImage: "当前头像", noImage: "未选择图片",
      gitSource: "Git 仓库（可选）", chooseLocalGit: "选择本地 Git", noGitSource: "未选择本地仓库",
      noLocalGit: "使用远程仓库", remoteGitUrl: "远程 Git 地址", remoteGitPlaceholder: "https://github.com/org/repo.git",
      choosingFolder: "选择中…", checkingFolder: "正在检查 Git 仓库…", directoryReadFailed: "无法读取所选文件夹",
      gitRequired: "所选文件夹不是 Git 仓库。", localWorktreeHint: "在成员目录中创建隔离 Git worktree。",
      remoteCloneHint: "将远程仓库 clone 到成员目录。", emptyMemberDirectoryHint: "创建空成员目录。",
      finalWorkingDirectory: "最终工作目录：{path}", memberDirectoryPlaceholder: "<成员名称>",
      model: "模型", reasoning: "推理强度",
      codexDefault: "跟随 Codex 默认", modelDefault: "模型默认（{effort}）", defaultOption: "默认",
      createMember: "创建成员", preparingMember: "正在准备成员目录并创建会话…", savingMember: "正在保存…", dismissError: "关闭",
      avatarTooLarge: "请选择小于 2 MB 的图片",
      avatarUnsupported: "请选择 PNG、JPEG、WebP 或 GIF 图片"
    }
  };
  const t = (key, values = {}) => String(messages[language()][key] ?? messages.en[key] ?? key)
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));

  state.update = (nextSnapshot, completeAction = false) => {
    const builtInAvatars = state.snapshot?.builtInAvatars ?? [];
    const availableModels = nextSnapshot.availableModels ?? state.snapshot?.availableModels ?? [];
    state.snapshot = { ...nextSnapshot, builtInAvatars, availableModels };
    const pendingOverlay = document.querySelector("#codex-agent-team-modal[data-pending-action]");
    if (pendingOverlay && (completeAction || nextSnapshot.error)) pendingOverlay.remove();
    renderSidebar();
    if (document.querySelector("#codex-agent-team-panel")) showPanel();
  };

  const send = (action) => {
    const bridge = window[state.bindingName];
    if (typeof bridge === "function") bridge(JSON.stringify(action));
  };
  state.workspaceInspectionCallbacks ??= new Map();
  state.receiveWorkspaceInspection = (payload) => {
    const callback = state.workspaceInspectionCallbacks.get(payload?.requestId);
    if (!callback) return;
    state.workspaceInspectionCallbacks.delete(payload.requestId);
    callback(payload);
  };
  const openThread = (teamId, member) => {
    send({ type: "openMember", teamId, threadId: member.threadId });
  };
  const avatar = (member, size = 28) => {
    const node = document.createElement(member.avatar ? "img" : "span");
    node.className = "cat-avatar";
    node.style.width = `${size}px`;
    node.style.height = `${size}px`;
    if (member.avatar) {
      node.src = member.avatar;
      node.alt = "";
    } else {
      node.textContent = Array.from(member.name).slice(0, 1).join("").toUpperCase();
    }
    return node;
  };
  const statusLabel = (status) => t(["running", "waiting", "idle", "offline", "error"].includes(status) ? status : "idle");
  const runtimeText = (member) => {
    const status = member.status ?? "offline";
    const node = document.createElement("span");
    node.className = `cat-runtime-text ${status}`;
    node.textContent = statusLabel(status);
    return node;
  };
  const avatarRing = (member, size = 34) => {
    const ring = document.createElement("span");
    ring.className = `cat-member-avatar-ring ${member.status ?? "offline"}`;
    ring.title = `${member.name} · ${statusLabel(member.status)}`;
    ring.append(avatar(member, size));
    return ring;
  };
  const chevronSvg = (className) => `<svg width="20" height="21" class="${className}" viewBox="0 0 20 21" fill="none" aria-hidden="true"><path d="M15.2793 7.71101C15.539 7.45131 15.961 7.45131 16.2207 7.71101C16.4804 7.97071 16.4804 8.39272 16.2207 8.65242L10.4707 14.4024C10.211 14.6621 9.78902 14.6621 9.52932 14.4024L3.77932 8.65242L3.69436 8.54792C3.52385 8.28979 3.55205 7.93828 3.77932 7.71101C4.00659 7.48374 4.3581 7.45554 4.61623 7.62605L4.72073 7.71101L10 12.9903L15.2793 7.71101Z" fill="currentColor" stroke="currentColor" stroke-width="0.6"/></svg>`;

  function ensureStyles() {
    const existing = document.querySelector("#codex-agent-team-styles");
    if (existing?.dataset.revision === "top-navigation-v4") return;
    existing?.remove();
    document.querySelector("#codex-agent-team-style-refinements")?.remove();
    const style = document.createElement("style");
    style.id = "codex-agent-team-styles";
    style.dataset.revision = "top-navigation-v4";
    style.textContent = styles;
    document.head.append(style);
  }

  function decorateNativeMemberRows() {
    const members = (state.snapshot.teams ?? []).flatMap((team) => team.members ?? []);
    const memberByThreadId = new Map(members.map((member) => [member.threadId, member]));
    const retained = new Set();
    for (const row of document.querySelectorAll("[data-app-action-sidebar-thread-row]")) {
      const threadId = row.getAttribute("data-app-action-sidebar-thread-id")
        ?? row.getAttribute("data-thread-id")
        ?? "";
      const member = memberByThreadId.get(threadId)
        ?? memberByThreadId.get(threadId.split(":").at(-1));
      if (member) retained.add(decorateNativeMemberRow(row, member));
      else row.querySelector("[data-codex-agent-team-member-avatar]")?.remove();
    }
    for (const marker of document.querySelectorAll("[data-codex-agent-team-member-avatar]")) {
      if (!retained.has(marker)) marker.remove();
    }
  }

  function decorateNativeMemberRow(row, member) {
    const title = row.querySelector("[data-thread-title-trigger]");
    const leadingSlot = title?.parentElement?.firstElementChild;
    if (!leadingSlot) return;
    let marker = leadingSlot.querySelector("[data-codex-agent-team-member-avatar]");
    if (!marker) {
      marker = document.createElement("span");
      marker.setAttribute("data-codex-agent-team-member-avatar", member.threadId);
      marker.setAttribute("aria-hidden", "true");
      marker.className = "cat-native-member-avatar";
      leadingSlot.append(marker);
    }
    const signature = `${member.name}\u0000${member.avatar ?? ""}`;
    if (marker.dataset.signature !== signature) {
      marker.dataset.signature = signature;
      marker.replaceChildren(avatar(member, 16));
    }
    return marker;
  }

  function renderSidebar() {
    const templateButton = findNativeTopNavigationItem(document);
    if (!templateButton) return false;
    const templateRoot = templateButton.parentElement?.children.length === 1
      ? templateButton.parentElement
      : templateButton;
    const signature = `${templateRoot.tagName}\u0000${templateRoot.className}\u0000${templateButton.className}`;
    let root = document.querySelector("[data-codex-agent-team-nav]");
    if (root && (
      root.parentElement !== templateRoot.parentElement
      || root.dataset.templateSignature !== signature
    )) {
      root.remove();
      root = null;
    }
    if (!root) {
      root = templateRoot.cloneNode(true);
      for (const node of [root, ...root.querySelectorAll("*")]) {
        for (const attribute of [...node.attributes]) {
          if (attribute.name === "id"
            || attribute.name === "href"
            || attribute.name === "aria-current"
            || attribute.name === "aria-pressed"
            || attribute.name === "data-state"
            || attribute.name.startsWith("data-app-action-")) {
            node.removeAttribute(attribute.name);
          }
        }
      }
      root.setAttribute("data-codex-agent-team-nav", "true");
      root.dataset.templateSignature = signature;
      const button = root.matches("button,a,[role=button]")
        ? root
        : root.querySelector("button,a,[role=button]");
      if (!button) return false;
      const labels = ["Plugins", "插件"];
      const label = [...root.querySelectorAll("span,div,p")]
        .find((node) => !node.children.length && labels.includes(node.textContent?.trim()))
        ?? root.querySelector(".text-fade-truncate");
      if (label) label.textContent = "CodexAgentTeam";
      const iconSlot = button.querySelector("svg")?.parentElement;
      if (iconSlot) {
        iconSlot.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-xs" aria-hidden="true"><path d="M5.75 7.25A2.25 2.25 0 1 0 5.75 2.75a2.25 2.25 0 0 0 0 4.5ZM10.75 6.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM1.75 13.25v-.5a3.75 3.75 0 0 1 7.5 0v.5M9 9.25a3.25 3.25 0 0 1 5.25 2.56v1.44" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      }
      button.setAttribute("aria-label", "CodexAgentTeam");
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        send({ type: "refresh" });
        showPanel();
      };
      templateRoot.insertAdjacentElement("afterend", root);
    } else if (root.previousElementSibling !== templateRoot) {
      templateRoot.insertAdjacentElement("afterend", root);
    }
    decorateNativeMemberRows();
    return true;
  }

  function showPanel() {
    const main = document.querySelector("main");
    if (!main) return;
    state.panelResizeObserver?.disconnect();
    document.querySelector("#codex-agent-team-panel")?.remove();
    const panel = document.createElement("div");
    panel.id = "codex-agent-team-panel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", t("panelLabel"));
    const shell = document.createElement("div");
    shell.className = "cat-shell";
    const teams = [...state.snapshot.teams];
    const rank = { error: 0, waiting: 1, running: 2, idle: 3, offline: 4 };
    const memberStatus = (member) => member.status ?? "offline";
    const teamStatus = (team) => {
      const statuses = team.members.map(memberStatus);
      return statuses.includes("error") ? "error"
        : statuses.includes("waiting") ? "waiting"
        : statuses.includes("running") ? "running"
          : statuses.length > 0 && statuses.every((status) => status === "offline") ? "offline"
          : "idle";
    };
    teams.sort((left, right) => rank[teamStatus(left)] - rank[teamStatus(right)] || left.name.localeCompare(right.name, clientLocale()));
    state.expandedTeamIds ??= new Set();
    const toolbar = document.createElement("div");
    toolbar.className = "cat-panel-toolbar";
    const brand = document.createElement("div");
    brand.className = "cat-brand";
    const brandTitle = document.createElement("h1");
    brandTitle.textContent = "CodexAgentTeam";
    const brandMeta = document.createElement("div");
    brandMeta.className = "cat-brand-meta";
    const teamCount = document.createElement("span");
    teamCount.textContent = t(teams.length === 1 ? "teamCountOne" : "teamCount", {
      count: new Intl.NumberFormat(clientLocale()).format(teams.length)
    });
    const separator = document.createElement("span");
    separator.className = "cat-brand-meta-separator";
    separator.textContent = "·";
    const connection = document.createElement("span");
    const connectionStatus = state.snapshot.connectionStatus === "connected" ? "connected" : "disconnected";
    connection.className = `cat-connection-state ${connectionStatus}`;
    connection.textContent = t(connectionStatus);
    brandMeta.append(teamCount, separator, connection);
    brand.append(brandTitle, brandMeta);
    const actions = document.createElement("div");
    actions.className = "cat-actions";
    const expandAll = document.createElement("button");
    expandAll.className = "cat-team-expand-all";
    const allExpanded = teams.length > 0 && teams.every((team) => state.expandedTeamIds.has(team.teamId));
    expandAll.textContent = t(allExpanded ? "collapseAll" : "expandAll");
    expandAll.onclick = () => {
      state.expandedTeamIds = allExpanded ? new Set() : new Set(teams.map((team) => team.teamId));
      showPanel();
    };
    const create = document.createElement("button");
    create.type = "button";
    create.className = "cat-button primary";
    create.textContent = t("newTeam");
    create.onclick = () => showTeamForm();
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cat-button tertiary";
    close.textContent = t("back");
    close.onclick = closePanel;
    actions.append(expandAll, create, close);
    toolbar.append(brand, actions);
    shell.append(toolbar);
    if (state.snapshot.error) {
      const error = document.createElement("div");
      error.className = "cat-error";
      const errorMessage = document.createElement("span");
      errorMessage.className = "cat-error-message";
      errorMessage.textContent = state.snapshot.error;
      const dismissError = document.createElement("button");
      dismissError.type = "button";
      dismissError.className = "cat-error-dismiss";
      dismissError.textContent = "×";
      dismissError.title = t("dismissError");
      dismissError.setAttribute("aria-label", t("dismissError"));
      dismissError.onclick = () => {
        state.snapshot = { ...state.snapshot, error: null };
        error.remove();
      };
      error.append(errorMessage, dismissError);
      shell.append(error);
    }
    if (state.notice) {
      const notice = document.createElement("div");
      notice.className = "cat-notice";
      notice.textContent = state.notice;
      shell.append(notice);
      setTimeout(() => { state.notice = null; notice.remove(); }, 2600);
    }
    const directory = document.createElement("section");
    directory.className = "cat-team-directory cat-glass";
    for (const team of teams) {
      const expanded = state.expandedTeamIds.has(team.teamId);
      const group = document.createElement("article");
      group.className = "cat-team-directory-group";
      const row = document.createElement("button");
      row.type = "button";
      row.className = "cat-team-directory-row";
      row.setAttribute("aria-expanded", String(expanded));
      row.setAttribute("aria-controls", `cat-team-members-${team.teamId}`);
      const name = document.createElement("span");
      name.className = "cat-team-directory-name";
      name.textContent = team.name;
      const carousel = document.createElement("span");
      carousel.className = "cat-member-carousel";
      for (const member of team.members) carousel.append(avatarRing(member));
      const stateLabel = document.createElement("span");
      stateLabel.className = `cat-team-state ${teamStatus(team)}`;
      stateLabel.textContent = statusLabel(teamStatus(team));
      const chevron = document.createElement("span");
      chevron.className = "cat-team-chevron";
      chevron.innerHTML = chevronSvg("cat-team-chevron-icon");
      row.append(name, carousel, stateLabel, chevron);
      row.onclick = () => {
        if (expanded) state.expandedTeamIds.delete(team.teamId);
        else state.expandedTeamIds.add(team.teamId);
        showPanel();
      };
      const members = document.createElement("div");
      members.id = `cat-team-members-${team.teamId}`;
      members.className = "cat-team-directory-members";
      members.hidden = !expanded;
      const memberActions = document.createElement("div");
      memberActions.className = "cat-team-inline-actions";
      const terminalActions = document.createElement("span");
      terminalActions.className = "cat-terminal-actions";
      const terminalLabel = document.createElement("span");
      terminalLabel.className = "cat-terminal-label";
      terminalLabel.textContent = t("openCli");
      terminalActions.append(terminalLabel);
      for (const [terminal, label] of [["ghostty", "openGhostty"], ["cmux", "openCmux"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cat-terminal-action";
        button.textContent = terminal === "ghostty" ? "Ghostty" : "cmux";
        button.title = t(label);
        button.setAttribute("aria-label", t(label));
        button.disabled = team.members.length === 0;
        button.onclick = () => send({ type: "openTeamTerminal", teamId: team.teamId, terminal });
        terminalActions.append(button);
      }
      memberActions.append(terminalActions);
      for (const [text, handler] of [[t("addMember"), () => showMemberForm(team)], [t("editTeam"), () => showTeamForm(team)], [t("removeTeam"), () => showConfirmation({ title: t("removeTeamTitle", { name: team.name }), description: t("removeTeamDescription"), confirmText: t("removeTeam"), action: { type: "removeTeam", teamId: team.teamId } })]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cat-text-action";
        button.textContent = text;
        button.onclick = handler;
        memberActions.append(button);
      }
      members.append(memberActions);
      const list = document.createElement("div");
      list.className = "cat-member-list";
      for (const member of [...team.members].sort((left, right) => rank[memberStatus(left)] - rank[memberStatus(right)] || left.name.localeCompare(right.name, clientLocale()))) {
        const memberRow = document.createElement("div");
        memberRow.className = "cat-member-row";
        const memberOpen = document.createElement("button");
        memberOpen.type = "button";
        memberOpen.className = "cat-member-open";
        memberOpen.append(avatarRing(member, 42));
        const copy = document.createElement("div");
        copy.className = "cat-member-copy";
        const memberName = document.createElement("div");
        memberName.className = "cat-member-name";
        memberName.textContent = member.name;
        const role = document.createElement("div");
        role.className = "cat-member-role";
        role.textContent = member.role || t("noRole");
        copy.append(memberName, role);
        const rowActions = document.createElement("div");
        rowActions.className = "cat-member-row-actions";
        for (const [text, handler] of [[t("edit"), () => showMemberForm(team, member)], [t("removeMember"), () => showConfirmation({ title: t("removeMemberTitle", { name: member.name }), description: t("removeMemberDescription"), confirmText: t("removeMember"), action: { type: "removeMember", teamId: team.teamId, threadId: member.threadId } })]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "cat-text-action";
          button.textContent = text;
          button.onclick = (event) => { event.stopPropagation(); handler(); };
          rowActions.append(button);
        }
        memberOpen.append(copy, runtimeText(member));
        memberOpen.onclick = () => openThread(team.teamId, member);
        memberRow.append(memberOpen, rowActions);
        list.append(memberRow);
      }
      if (!team.members.length) {
        const empty = document.createElement("div");
        empty.className = "cat-team-empty";
        empty.textContent = t("noMembers");
        list.append(empty);
      }
      members.append(list);
      group.append(row, members);
      directory.append(group);
    }
    if (!teams.length) {
      const empty = document.createElement("div");
      empty.className = "cat-empty";
      const emptyTitle = document.createElement("h3");
      emptyTitle.textContent = t("noTeams");
      const emptyDescription = document.createElement("p");
      emptyDescription.textContent = t("noTeamsDescription");
      empty.append(emptyTitle, emptyDescription);
      directory.append(empty);
    }
    shell.append(directory);
    panel.append(shell);
    document.body.append(panel);
    syncPanelBounds();
    if (typeof ResizeObserver === "function") {
      state.panelResizeObserver = new ResizeObserver(syncPanelBounds);
      state.panelResizeObserver.observe(main);
    }
  }

  function syncPanelBounds() {
    const panel = document.querySelector("#codex-agent-team-panel");
    const main = document.querySelector("main");
    if (!panel || !main) return;
    const bounds = main.getBoundingClientRect();
    panel.style.left = `${bounds.left}px`;
    panel.style.top = `${bounds.top}px`;
    panel.style.width = `${bounds.width}px`;
    panel.style.height = `${bounds.height}px`;
  }

  function closePanel() {
    state.panelResizeObserver?.disconnect();
    state.panelResizeObserver = null;
    document.querySelector("#codex-agent-team-panel")?.remove();
    document.querySelector("#codex-agent-team-modal")?.remove();
  }

  state.closePanel = closePanel;

  function modal(titleText, descriptionText = "") {
    document.querySelector("#codex-agent-team-modal")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "codex-agent-team-modal";
    const surface = document.querySelector("main") ?? document.body;
    const channels = getComputedStyle(surface).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
    const hasOpaqueSurface = channels.length >= 3 && (channels[3] ?? 1) > 0;
    const dark = hasOpaqueSurface
      ? (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000 < 145
      : window.matchMedia?.("(prefers-color-scheme: dark)")?.matches !== false;
    overlay.dataset.colorScheme = dark ? "dark" : "light";
    overlay.style.colorScheme = overlay.dataset.colorScheme;
    const dialog = document.createElement("form");
    dialog.className = "cat-dialog cat-glass";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const title = document.createElement("h2");
    title.id = `codex-agent-team-dialog-title-${state.fieldSequence = (state.fieldSequence ?? 0) + 1}`;
    title.textContent = titleText;
    dialog.setAttribute("aria-labelledby", title.id);
    dialog.append(title);
    if (descriptionText) {
      const description = document.createElement("p");
      description.className = "cat-dialog-description";
      description.textContent = descriptionText;
      dialog.append(description);
    }
    overlay.append(dialog);
    document.body.append(overlay);
    overlay.onclick = (event) => {
      if (event.target === overlay && !overlay.dataset.pendingAction) overlay.remove();
    };
    overlay.onkeydown = (event) => {
      if (event.key === "Escape" && !overlay.dataset.pendingAction) overlay.remove();
    };
    return { overlay, dialog };
  }

  function field(dialog, labelText, type = "text", value = "") {
    const wrap = document.createElement("div");
    wrap.className = "cat-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = type === "textarea" ? document.createElement("textarea") : document.createElement("input");
    if (type !== "textarea") input.type = type;
    input.id = `codex-agent-team-field-${state.fieldSequence = (state.fieldSequence ?? 0) + 1}`;
    label.htmlFor = input.id;
    input.value = value;
    wrap.append(label, input);
    dialog.append(wrap);
    return input;
  }

  function dialogActions(dialog, overlay, submitText, dangerous = false) {
    const actions = document.createElement("div");
    actions.className = "cat-dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cat-button";
    cancel.textContent = t("cancel");
    cancel.onclick = () => overlay.remove();
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = `cat-button ${dangerous ? "danger" : "primary"}`;
    submit.textContent = submitText;
    actions.append(cancel, submit);
    dialog.append(actions);
    return { cancel, submit };
  }

  function showTeamForm(team = null) {
    const { overlay, dialog } = modal(
      t(team ? "editTeam" : "createTeam"),
      t(team ? "editTeamDescription" : "createTeamDescription")
    );
    const name = field(dialog, t("teamName"), "text", team?.name ?? "");
    dialogActions(dialog, overlay, t(team ? "save" : "create"));
    dialog.onsubmit = (event) => {
      event.preventDefault();
      send(team
        ? { type: "renameTeam", teamId: team.teamId, name: name.value }
        : { type: "createTeam", name: name.value });
      overlay.remove();
    };
    name.focus();
  }

  function showConfirmation({ title, description, confirmText, action }) {
    const { overlay, dialog } = modal(title, description);
    dialogActions(dialog, overlay, confirmText, true);
    dialog.onsubmit = (event) => {
      event.preventDefault();
      send(action);
      overlay.remove();
    };
  }

  function showMemberForm(team, member = null) {
    const { overlay, dialog } = modal(
      member ? t("editMember") : t("addToTeam", { name: team.name }),
      member
        ? t("editMemberDescription")
        : t("createMemberDescription")
    );
    const name = field(dialog, t("memberName"), "text", member?.name ?? "");
    const role = field(dialog, t("role"), "textarea", member?.role ?? "");

    const avatarField = document.createElement("div");
    avatarField.className = "cat-field";
    avatarField.setAttribute("role", "group");
    const avatarLabel = document.createElement("label");
    avatarLabel.textContent = t("avatar");
    avatarField.setAttribute("aria-label", avatarLabel.textContent);
    const avatarToggle = document.createElement("div");
    avatarToggle.className = "cat-avatar-source-toggle";
    const presetModeButton = document.createElement("button");
    presetModeButton.type = "button";
    presetModeButton.className = "cat-avatar-source-option";
    presetModeButton.textContent = t("builtInAvatars");
    const customModeButton = document.createElement("button");
    customModeButton.type = "button";
    customModeButton.className = "cat-avatar-source-option";
    customModeButton.textContent = t("customAvatar");
    avatarToggle.append(presetModeButton, customModeButton);

    const presets = state.snapshot.builtInAvatars ?? [];
    const matchingPreset = presets.find((preset) => preset.dataUrl === member?.avatar) ?? null;
    let avatarMode = member?.avatar && !matchingPreset ? "custom" : "builtin";
    let selectedPresetAvatarDataUrl = matchingPreset?.dataUrl ?? null;
    let selectedCustomAvatarDataUrl = null;
    if (!presets.length) avatarMode = "custom";
    else selectedPresetAvatarDataUrl ??= presets[0].dataUrl;
    const presetPanel = document.createElement("div");
    presetPanel.className = "cat-avatar-source-panel";
    const presetGrid = document.createElement("div");
    presetGrid.className = "cat-avatar-presets";
    for (const preset of presets) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cat-avatar-preset";
      const presetLabel = preset.labels?.[language()] ?? preset.labels?.en ?? preset.name ?? preset.id;
      button.title = presetLabel;
      button.setAttribute("aria-label", presetLabel);
      button.setAttribute("aria-pressed", String(preset.dataUrl === selectedPresetAvatarDataUrl));
      const image = document.createElement("img");
      image.src = preset.dataUrl;
      image.alt = "";
      button.append(image);
      button.onclick = () => {
        avatarMode = "builtin";
        selectedPresetAvatarDataUrl = preset.dataUrl;
        presetGrid.querySelectorAll(".cat-avatar-preset").forEach((candidate) =>
          candidate.setAttribute("aria-pressed", String(candidate === button))
        );
        renderAvatarMode();
      };
      presetGrid.append(button);
    }
    presetPanel.append(presetGrid);

    const customPanel = document.createElement("div");
    customPanel.className = "cat-avatar-source-panel";
    const customPicker = document.createElement("div");
    customPicker.className = "cat-picker";
    const customPreview = document.createElement("img");
    customPreview.className = "cat-picker-preview";
    customPreview.alt = "";
    customPreview.hidden = !member?.avatar;
    if (member?.avatar) customPreview.src = member.avatar;
    const avatarInput = document.createElement("input");
    avatarInput.type = "file";
    avatarInput.accept = ".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif";
    avatarInput.className = "cat-hidden-input";
    const chooseImage = document.createElement("button");
    chooseImage.type = "button";
    chooseImage.className = "cat-picker-button";
    chooseImage.textContent = t("chooseImage");
    chooseImage.onclick = () => avatarInput.click();
    const imageValue = document.createElement("span");
    imageValue.className = "cat-picker-value";
    imageValue.textContent = member?.avatar ? t("currentImage") : t("noImage");
    customPicker.append(customPreview, chooseImage, imageValue, avatarInput);
    customPanel.append(customPicker);
    avatarInput.onchange = async () => {
      if (!avatarInput.files?.length) return;
      const file = avatarInput.files[0];
      if (file.size > 2 * 1024 * 1024) {
        selectedCustomAvatarDataUrl = null;
        avatarInput.value = "";
        imageValue.textContent = t("avatarTooLarge");
        return;
      }
      if (file.type && !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
        selectedCustomAvatarDataUrl = null;
        avatarInput.value = "";
        imageValue.textContent = t("avatarUnsupported");
        return;
      }
      selectedCustomAvatarDataUrl = await readFileAsDataUrl(file);
      customPreview.src = selectedCustomAvatarDataUrl;
      customPreview.hidden = false;
      imageValue.textContent = file.name;
    };

    const renderAvatarMode = () => {
      presetModeButton.setAttribute("aria-pressed", String(avatarMode === "builtin"));
      customModeButton.setAttribute("aria-pressed", String(avatarMode === "custom"));
      presetPanel.hidden = avatarMode !== "builtin";
      customPanel.hidden = avatarMode !== "custom";
    };
    presetModeButton.disabled = !presets.length;
    presetModeButton.onclick = () => {
      avatarMode = "builtin";
      selectedPresetAvatarDataUrl ??= presets[0]?.dataUrl ?? null;
      renderAvatarMode();
    };
    customModeButton.onclick = () => { avatarMode = "custom"; renderAvatarMode(); };
    avatarField.append(avatarLabel, avatarToggle, presetPanel, customPanel);
    dialog.append(avatarField);
    renderAvatarMode();

    let localGitDirectory = "";
    let remoteGitUrl = "";
    let sourceInspectionPending = false;
    let sourceInspectionError = null;
    let memberActions = null;
    if (!member) {
      const directoryField = document.createElement("div");
      directoryField.className = "cat-field";
      const directoryLabel = document.createElement("label");
      directoryLabel.textContent = t("gitSource");
      const directoryPicker = document.createElement("div");
      directoryPicker.className = "cat-picker";
      directoryPicker.setAttribute("role", "group");
      directoryPicker.setAttribute("aria-label", directoryLabel.textContent);
      const directoryButton = document.createElement("button");
      directoryButton.type = "button";
      directoryButton.className = "cat-picker-button";
      directoryButton.textContent = t("chooseLocalGit");
      const directoryValue = document.createElement("span");
      directoryValue.className = "cat-picker-value";
      directoryValue.textContent = t("noGitSource");
      const remoteInput = document.createElement("input");
      remoteInput.type = "text";
      remoteInput.placeholder = t("remoteGitPlaceholder");
      remoteInput.setAttribute("aria-label", t("remoteGitUrl"));
      const sourceHint = document.createElement("p");
      sourceHint.className = "cat-directory-hint";
      const workingDirectoryPreview = document.createElement("p");
      workingDirectoryPreview.className = "cat-directory-hint";

      const renderGitSource = () => {
        if (sourceInspectionPending) {
          sourceHint.textContent = t("checkingFolder");
        } else if (sourceInspectionError) {
          sourceHint.textContent = sourceInspectionError;
        } else if (localGitDirectory) {
          sourceHint.textContent = t("localWorktreeHint");
        } else if (remoteGitUrl) {
          sourceHint.textContent = t("remoteCloneHint");
        } else {
          sourceHint.textContent = t("emptyMemberDirectoryHint");
        }
        const memberDirectory = name.value.trim() || t("memberDirectoryPlaceholder");
        const finalPath = `${team.teamDirectory.replace(/\/+$/, "")}/members/${memberDirectory}`;
        workingDirectoryPreview.textContent = t("finalWorkingDirectory", { path: finalPath });
        if (memberActions) memberActions.submit.disabled = sourceInspectionPending || Boolean(sourceInspectionError);
      };
      directoryButton.onclick = async () => {
        const originalText = directoryButton.textContent;
        directoryButton.disabled = true;
        directoryButton.textContent = t("choosingFolder");
        try {
          const selected = await chooseNativeDirectory(window);
          if (selected) {
            localGitDirectory = selected;
            remoteGitUrl = "";
            remoteInput.value = "";
            sourceInspectionError = null;
            directoryValue.textContent = selected;
            sourceInspectionPending = true;
            renderGitSource();
            const requestId = `workspace-${Date.now()}-${state.fieldSequence = (state.fieldSequence ?? 0) + 1}`;
            state.workspaceInspectionCallbacks.set(requestId, (inspection) => {
              if (localGitDirectory !== selected) return;
              sourceInspectionPending = false;
              if (inspection.error) {
                sourceInspectionError = inspection.error;
                renderGitSource();
                return;
              }
              localGitDirectory = inspection.gitRoot || inspection.path || selected;
              directoryValue.textContent = localGitDirectory;
              sourceInspectionError = inspection.isGit === true ? null : t("gitRequired");
              renderGitSource();
            });
            send({ type: "inspectWorkingDirectory", requestId, path: selected });
          }
        } catch {
          directoryValue.textContent = t("directoryReadFailed");
        } finally {
          directoryButton.disabled = false;
          directoryButton.textContent = originalText;
        }
      };
      remoteInput.oninput = () => {
        remoteGitUrl = remoteInput.value.trim();
        if (remoteGitUrl) {
          localGitDirectory = "";
          directoryValue.textContent = t("noLocalGit");
          sourceInspectionError = null;
        }
        renderGitSource();
      };
      directoryPicker.append(directoryButton, directoryValue);
      directoryField.append(directoryLabel, directoryPicker, remoteInput, sourceHint, workingDirectoryPreview);
      dialog.append(directoryField);
      name.addEventListener("input", renderGitSource);
      renderGitSource();
    }

    let modelSelect = null;
    let effortSelect = null;
    if (!member) {
    const settingsGrid = document.createElement("div");
    settingsGrid.className = "cat-form-grid";
    const modelWrap = document.createElement("div");
    modelWrap.className = "cat-field";
    const modelLabel = document.createElement("label");
    modelLabel.textContent = t("model");
    modelSelect = document.createElement("select");
    modelSelect.id = `codex-agent-team-field-${state.fieldSequence = (state.fieldSequence ?? 0) + 1}`;
    modelLabel.htmlFor = modelSelect.id;
    const availableModels = Array.isArray(state.snapshot.availableModels)
      ? state.snapshot.availableModels
      : [];
    const defaultModel = availableModels.find((candidate) => candidate.isDefault) ?? availableModels[0] ?? null;
    const codexDefault = document.createElement("option");
    codexDefault.value = "";
    codexDefault.textContent = defaultModel
      ? `${t("codexDefault")} · ${defaultModel.displayName}`
      : t("codexDefault");
    modelSelect.append(codexDefault);
    for (const candidate of availableModels) {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.displayName;
      option.title = candidate.description || candidate.id;
      modelSelect.append(option);
    }
    modelSelect.value = "";
    modelWrap.append(modelLabel, modelSelect);

    const effortWrap = document.createElement("div");
    effortWrap.className = "cat-field";
    const effortLabel = document.createElement("label");
    effortLabel.textContent = t("reasoning");
    effortSelect = document.createElement("select");
    effortSelect.id = `codex-agent-team-field-${state.fieldSequence = (state.fieldSequence ?? 0) + 1}`;
    effortLabel.htmlFor = effortSelect.id;
    effortWrap.append(effortLabel, effortSelect);
    const renderReasoningEfforts = (preferred = "") => {
      const selectedModel = modelSelect.value
        ? availableModels.find((candidate) => candidate.id === modelSelect.value)
        : defaultModel;
      const efforts = selectedModel?.supportedReasoningEfforts ?? [];
      effortSelect.replaceChildren();
      const modelDefault = document.createElement("option");
      modelDefault.value = "";
      modelDefault.textContent = selectedModel?.defaultReasoningEffort
        ? t("modelDefault", { effort: selectedModel.defaultReasoningEffort })
        : t("defaultOption");
      effortSelect.append(modelDefault);
      for (const candidate of efforts) {
        const option = document.createElement("option");
        option.value = candidate.id;
        option.textContent = candidate.id;
        option.title = candidate.description || candidate.id;
        effortSelect.append(option);
      }
      effortSelect.value = efforts.some((candidate) => candidate.id === preferred) ? preferred : "";
    };
    modelSelect.onchange = () => renderReasoningEfforts("");
    renderReasoningEfforts("");
    settingsGrid.append(modelWrap, effortWrap);
    dialog.append(settingsGrid);
    }
    memberActions = dialogActions(dialog, overlay, t(member ? "save" : "createMember"));
    dialog.onsubmit = async (event) => {
      event.preventDefault();
      const selectedAvatarDataUrl = avatarMode === "builtin"
        ? selectedPresetAvatarDataUrl
        : selectedCustomAvatarDataUrl ?? (avatarInput.files?.[0]
          ? await readFileAsDataUrl(avatarInput.files[0])
          : null);
      const avatarDataUrl = selectedAvatarDataUrl && selectedAvatarDataUrl !== member?.avatar
        ? selectedAvatarDataUrl
        : null;
      overlay.dataset.pendingAction = "true";
      dialog.setAttribute("aria-busy", "true");
      for (const control of dialog.elements) {
        control.disabled = control !== memberActions.cancel;
      }
      memberActions.submit.textContent = t(member ? "savingMember" : "preparingMember");
      send(member ? {
        type: "updateMember",
        teamId: team.teamId,
        threadId: member.threadId,
        name: name.value,
        role: role.value,
        ...(avatarDataUrl ? { avatarDataUrl } : {})
      } : {
        type: "createMember",
        teamId: team.teamId,
        name: name.value,
        role: role.value,
        localGitDirectory,
        remoteGitUrl,
        model: modelSelect?.value ?? "",
        reasoningEffort: effortSelect?.value ?? "",
        ...(avatarDataUrl ? { avatarDataUrl } : {})
      });
    };
    name.focus();
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error ?? new Error("File could not be read"));
      reader.readAsDataURL(file);
    });
  }

  ensureStyles();
  renderSidebar();
  if (document.querySelector("#codex-agent-team-panel")) showPanel();
  if (!state.onPanelWindowResize) {
    state.onPanelWindowResize = syncPanelBounds;
    window.addEventListener("resize", state.onPanelWindowResize);
  }
  if (!state.onNativeNavigation) {
    state.onNativeNavigation = (event) => {
      if (!document.querySelector("#codex-agent-team-panel")) return;
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      if (!target || target.closest("#codex-agent-team-panel, #codex-agent-team-modal, [data-codex-agent-team-nav]")) return;
      closePanel();
    };
    document.addEventListener("click", state.onNativeNavigation, true);
  }
  if (!state.observer) {
    let scheduled = false;
    state.observer = new MutationObserver((records) => {
      const missing = !document.querySelector("[data-codex-agent-team-nav]");
      const nativeSidebarChanged = records.some((record) => {
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        if (target?.closest?.("[data-codex-agent-team-nav]")) return false;
        return [...(record.addedNodes ?? []), ...(record.removedNodes ?? [])].some((node) =>
          node?.nodeType === 1 && (
            node.matches?.("button.sidebar-item,a.sidebar-item") ||
            node.querySelector?.("button.sidebar-item,a.sidebar-item") ||
            node.matches?.("[data-app-action-sidebar-thread-row]") ||
            node.querySelector?.("[data-app-action-sidebar-thread-row]")
          )
        );
      });
      if (scheduled || (!missing && !nativeSidebarChanged)) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; renderSidebar(); }, 30);
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  if (!state.localeObserver) {
    state.localeObserver = new MutationObserver(() => {
      renderSidebar();
      if (document.querySelector("#codex-agent-team-panel")) showPanel();
    });
    state.localeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"]
    });
  }
  state.dispose = () => {
    state.observer?.disconnect();
    state.observer = null;
    state.localeObserver?.disconnect();
    state.localeObserver = null;
    for (const marker of document.querySelectorAll("[data-codex-agent-team-member-avatar]")) marker.remove();
    window.removeEventListener("resize", state.onPanelWindowResize);
    state.onPanelWindowResize = null;
    document.removeEventListener("click", state.onNativeNavigation, true);
    state.onNativeNavigation = null;
    state.update = null;
    state.closePanel = null;
    document.querySelector("[data-codex-agent-team-nav]")?.remove();
    closePanel();
    document.querySelector("#codex-agent-team-styles")?.remove();
  };
  return { installed: Boolean(document.querySelector("[data-codex-agent-team-nav]")) };
}
