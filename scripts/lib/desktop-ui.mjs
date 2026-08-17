export function buildTeamUiExpression(snapshot, bindingName) {
  return `;(${installTeamUi.toString()})(${JSON.stringify(snapshot)}, ${JSON.stringify(bindingName)}, (${decorateNativeMemberRows.toString()}))`;
}

export function decorateNativeMemberRows(document, teams = []) {
  const members = teams.flatMap((team) => team.members ?? []);
  const rows = document.querySelectorAll(
    "[data-codex-agent-team-section] [data-app-action-sidebar-thread-id],"
    + "[data-codex-agent-team-section] [data-thread-id]"
  );

  for (const row of rows) {
    const nativeThreadId = row.getAttribute("data-app-action-sidebar-thread-id")
      ?? row.getAttribute("data-thread-id")
      ?? "";
    const member = members.find((candidate) => nativeThreadId === candidate.threadId
      || nativeThreadId.endsWith(`:${candidate.threadId}`));
    let marker = row.querySelector("[data-codex-agent-team-member-avatar]");
    if (!member) {
      marker?.remove();
      continue;
    }

    if (!marker) {
      const title = row.querySelector("[data-thread-title-trigger]");
      const leadingSlot = title?.parentElement?.firstElementChild;
      if (!leadingSlot || leadingSlot === title) continue;
      marker = document.createElement("span");
      marker.setAttribute("data-codex-agent-team-member-avatar", member.id);
      marker.setAttribute("aria-hidden", "true");
      marker.className = "cat-native-member-avatar";
      leadingSlot.appendChild(marker);
    }

    const initial = Array.from(member.name ?? "?").slice(0, 1).join("").toUpperCase() || "?";
    const value = member.avatar ? `image:${member.avatar}` : `initial:${initial}`;
    marker.setAttribute("data-codex-agent-team-member-avatar", member.id);
    if (marker.__codexAgentTeamAvatarValue === value) continue;
    marker.__codexAgentTeamAvatarValue = value;
    if (member.avatar) {
      const image = document.createElement("img");
      image.src = member.avatar;
      image.alt = "";
      image.draggable = false;
      marker.replaceChildren(image);
    } else {
      marker.replaceChildren();
      marker.textContent = initial;
    }
  }
}

function installTeamUi(snapshot, bindingName, decorateNativeMemberRows) {
  const state = window.__codexAgentTeam ??= {};
  state.snapshot = snapshot;
  state.bindingName = bindingName;
  state.projectOrigins ??= new Map();

  const clientLocale = () => document.documentElement.lang
    || navigator.languages?.[0]
    || navigator.language
    || "en";
  const language = () => /^zh(?:-|$)/i.test(clientLocale()) ? "zh" : "en";
  const messages = {
    en: {
      teams: "Teams", manage: "Manage", panelLabel: "AgentTeam management",
      connected: "Connected", disconnected: "Disconnected", teamCount: "{count} teams",
      running: "Running", waiting: "Needs attention", idle: "Idle", offline: "Idle",
      newTeam: "New Team", stopMode: "Turn Off", back: "Back",
      expandAll: "Expand All", collapseAll: "Collapse All", addMember: "Add Member",
      editTeam: "Edit Team", removeTeam: "Remove Team", noRole: "No role set",
      edit: "Edit", removeMember: "Remove Member", noMembers: "No members yet",
      noTeams: "No teams yet", noTeamsDescription: "Create a team, then add members with their own native Codex conversations.",
      stopTitle: "Turn off Team mode?", stopDescription: "Teams, native member conversations, and workspaces will be preserved.",
      removeTeamTitle: "Remove “{name}”?", removeTeamDescription: "Native member conversations and workspaces will be preserved.",
      removeMemberTitle: "Remove “{name}”?", removeMemberDescription: "This native conversation and workspace will be preserved.",
      cliCopied: "CLI resume command copied for {name}", cliFailed: "Could not copy automatically: {command}",
      cancel: "Cancel", createTeam: "Create Team", teamName: "Team name", save: "Save", create: "Create",
      editTeamDescription: "The name also updates the native Codex project.",
      createTeamDescription: "Start with a name. Add members and project folders when you need them.",
      editMember: "Edit Member", addToTeam: "Add to {name}",
      editMemberDescription: "Name, role, avatar, and model settings stay attached to this native conversation.",
      createMemberDescription: "Creates an independent workspace and a persistent native Codex conversation.",
      memberName: "Member name", role: "Role", builtInAvatars: "Built-in avatars", avatarImage: "Avatar image",
      projectPath: "Project path (optional)", model: "Model (optional)", reasoning: "Reasoning effort",
      defaultOption: "Default", createMember: "Create Member"
    },
    zh: {
      teams: "团队", manage: "管理", panelLabel: "AgentTeam 管理",
      connected: "已连接", disconnected: "未连接", teamCount: "{count} 个团队",
      running: "运行中", waiting: "等待操作", idle: "空闲", offline: "空闲",
      newTeam: "创建团队", stopMode: "关闭模式", back: "返回",
      expandAll: "全部展开", collapseAll: "全部收起", addMember: "添加成员",
      editTeam: "编辑团队", removeTeam: "移除团队", noRole: "未设置职责",
      edit: "编辑", removeMember: "移除成员", noMembers: "暂无成员",
      noTeams: "还没有团队", noTeamsDescription: "创建团队后，再添加拥有独立原生会话的成员。",
      stopTitle: "关闭团队模式？", stopDescription: "团队数据、成员原生会话和工作目录都会保留。再次开启后可以继续使用。",
      removeTeamTitle: "移除「{name}」？", removeTeamDescription: "成员原生会话和工作目录都会保留。",
      removeMemberTitle: "移除成员「{name}」？", removeMemberDescription: "该成员的原生会话和工作目录都会保留。",
      cliCopied: "{name} 的 CLI 恢复命令已复制", cliFailed: "无法自动复制：{command}",
      cancel: "取消", createTeam: "创建团队", teamName: "团队名称", save: "保存", create: "创建",
      editTeamDescription: "团队名称会同步更新到 Codex 原生项目。",
      createTeamDescription: "只需一个名称。成员与项目目录可以稍后逐个添加。",
      editMember: "编辑成员", addToTeam: "添加到 {name}",
      editMemberDescription: "名称、职责、头像和模型设置会同步到这位成员的原生会话。",
      createMemberDescription: "创建后会立即生成独立工作目录和一个持久的原生 Codex 会话。",
      memberName: "成员名称", role: "职责", builtInAvatars: "内置头像", avatarImage: "头像图片",
      projectPath: "项目路径（可选）", model: "模型（可选）", reasoning: "推理强度",
      defaultOption: "默认", createMember: "创建成员"
    }
  };
  const t = (key, values = {}) => String(messages[language()][key] ?? messages.en[key] ?? key)
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));

  const send = (action) => {
    const bridge = window[state.bindingName];
    if (typeof bridge === "function") bridge(JSON.stringify(action));
  };
  const escape = (value) => globalThis.CSS?.escape
    ? CSS.escape(value)
    : String(value).replaceAll('"', '\\"');
  const exactLeaf = (labels) => Array.from(document.querySelectorAll("span,div,p,h2,h3"))
    .find((node) => !node.children.length && labels.includes(node.textContent?.trim()));
  const sectionContainer = (title) => {
    const semantic = title?.closest?.("section,[data-sidebar-section]");
    if (semantic) return semantic;
    let candidate = title?.parentElement;
    for (let depth = 0; candidate?.parentElement && depth < 5; depth += 1) {
      if (candidate.querySelector("button,a") && candidate.parentElement.children.length > 1) return candidate;
      candidate = candidate.parentElement;
    }
    return title?.parentElement ?? null;
  };
  const nativeProjectRow = (projectId) => document.querySelector(
    `[data-app-action-sidebar-project-id="${escape(projectId)}"]`
  );
  const nativeProjectWrapper = (projectId) => nativeProjectRow(projectId)
    ?.closest("[data-sidebar-project-kind]") ?? null;
  const nativeThreadRow = (threadId) => {
    const escaped = escape(threadId);
    const direct = document.querySelector(
      `[data-app-action-sidebar-thread-id="${escaped}"],[data-thread-id="${escaped}"]`
    );
    if (direct) return direct;
    return Array.from(document.querySelectorAll("[data-app-action-sidebar-thread-id]"))
      .find((node) => node.dataset.appActionSidebarThreadId?.endsWith(`:${threadId}`)) ?? null;
  };
  const openThread = (teamId, member) => {
    closePanel();
    send({ type: "navigateMember", teamId, memberId: member.id });
  };
  const memberForThreadRow = (row) => {
    const nativeThreadId = row?.getAttribute?.("data-app-action-sidebar-thread-id")
      ?? row?.getAttribute?.("data-thread-id")
      ?? "";
    for (const team of state.snapshot.teams ?? []) {
      const member = (team.members ?? []).find((candidate) => nativeThreadId === candidate.threadId
        || nativeThreadId.endsWith(`:${candidate.threadId}`));
      if (member) return { team, member };
    }
    return null;
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
  const statusLabel = (status) => t(["running", "waiting", "idle", "offline"].includes(status) ? status : "idle");
  const runtimeText = (member) => {
    const status = member.status === "offline" ? "idle" : (member.status ?? "idle");
    const node = document.createElement("span");
    node.className = `cat-runtime-text ${status}`;
    node.textContent = statusLabel(status);
    return node;
  };
  const avatarRing = (member, size = 34) => {
    const ring = document.createElement("span");
    ring.className = `cat-member-avatar-ring ${member.status === "offline" ? "idle" : (member.status ?? "idle")}`;
    ring.title = `${member.name} · ${statusLabel(member.status)}`;
    ring.append(avatar(member, size));
    return ring;
  };
  const chevronSvg = (className) => `<svg class="${className}" viewBox="0 0 20 21" fill="none" aria-hidden="true"><path d="M15.28 7.71a.666.666 0 0 1 .94.94l-5.75 5.75a.666.666 0 0 1-.94 0l-5.75-5.75a.666.666 0 0 1 .94-.94L10 12.99l5.28-5.28Z" fill="currentColor"/></svg>`;

  function ensureStyles() {
    const existing = document.querySelector("#codex-agent-team-styles");
    if (existing?.dataset.revision === "apple-dashboard-v1") return;
    existing?.remove();
    document.querySelector("#codex-agent-team-style-refinements")?.remove();
    const style = document.createElement("style");
    style.id = "codex-agent-team-styles";
    style.dataset.revision = "apple-dashboard-v1";
    style.textContent = `
      [data-codex-agent-team-section]{color:var(--text-primary,#eee);font:13px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif}
      .cat-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-inline:8px 2px}.cat-section-title{display:flex;min-width:0;flex:1;align-items:center;gap:2px;border:0;border-radius:6px;background:transparent;color:var(--text-secondary,#999);font:500 16px/1.4 inherit;padding:2px 4px 2px 0;text-align:left;cursor:pointer;opacity:.75}.cat-section-title:hover{color:var(--text-primary,#eee)}.cat-section-chevron{width:16px;height:16px;flex:0 0 auto;transition:transform .16s ease;opacity:0}.cat-section-title:hover .cat-section-chevron,.cat-section-title:focus-visible .cat-section-chevron{opacity:.8}.cat-section-title[aria-expanded="false"] .cat-section-chevron{transform:rotate(-90deg)}.cat-manage{border:0;border-radius:6px;background:transparent;color:var(--text-secondary,#999);padding:3px 7px;font:500 12px/1.4 inherit;cursor:pointer}.cat-manage:hover{background:color-mix(in srgb,currentColor 10%,transparent);color:var(--text-primary,#eee)}.cat-section-body{display:grid;gap:2px;padding-top:5px}.cat-section-body[hidden]{display:none}.cat-section-body>[data-sidebar-project-kind]{margin-inline:0}
      .cat-avatar{display:grid;place-items:center;flex:0 0 auto;border-radius:50%;object-fit:cover;background:color-mix(in srgb,currentColor 14%,transparent);font-size:11px;font-weight:700}
      .cat-native-member-avatar{display:grid;width:16px;height:16px;place-items:center;overflow:hidden;flex:0 0 auto;border-radius:50%;background:color-mix(in srgb,currentColor 14%,transparent);color:var(--text-primary,#eee);font-size:9px;font-weight:700;line-height:1}.cat-native-member-avatar img{width:100%;height:100%;object-fit:cover}
      #codex-agent-team-panel{--cat-blue:#7b78ed;--cat-green:#53ba91;--cat-amber:#e6a15e;--cat-red:#e77882;--cat-muted:color-mix(in srgb,var(--text-primary,#eee) 55%,transparent);--cat-line:color-mix(in srgb,var(--text-primary,#eee) 10%,transparent);position:fixed;z-index:70;box-sizing:border-box;overflow:auto;color:var(--text-primary,#eee);font:14px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;background:radial-gradient(circle at 7% 3%,color-mix(in srgb,#7773e8 18%,transparent),transparent 30%),radial-gradient(circle at 96% 5%,color-mix(in srgb,#e9a78e 15%,transparent),transparent 28%),radial-gradient(circle at 72% 94%,color-mix(in srgb,#9b80df 11%,transparent),transparent 34%),var(--background-primary,#111)}
      .cat-shell{max-width:1220px;margin:0 auto;padding:30px 38px 70px}.cat-glass{border:1px solid var(--cat-line);background:linear-gradient(145deg,color-mix(in srgb,var(--background-primary,#151515) 86%,#fff 7%),color-mix(in srgb,var(--background-primary,#151515) 95%,transparent));box-shadow:0 28px 90px #00000029,inset 0 1px 0 color-mix(in srgb,#fff 12%,transparent);backdrop-filter:blur(18px) saturate(135%);-webkit-backdrop-filter:blur(18px) saturate(135%)}
      .cat-dashboard-top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:20px}.cat-brand{display:flex;align-items:center;gap:12px}.cat-brand-mark{display:grid;width:38px;height:38px;place-items:center;border-radius:13px;color:#eef0ff;background:linear-gradient(145deg,#5d72df,#8a73df);box-shadow:0 12px 30px #6d70df47;font-size:18px}.cat-brand h1{margin:0;font-size:18px;letter-spacing:-.02em}.cat-brand p{margin:2px 0 0;color:var(--cat-muted);font-size:12px}.cat-actions,.cat-team-actions,.cat-member-actions{display:flex;align-items:center;gap:7px}.cat-button{border:1px solid color-mix(in srgb,currentColor 12%,transparent);background:color-mix(in srgb,currentColor 3%,transparent);color:inherit;border-radius:11px;padding:8px 12px;cursor:pointer;transition:background .15s ease,transform .15s ease,border-color .15s ease}.cat-button:hover{background:color-mix(in srgb,currentColor 7%,transparent);border-color:color-mix(in srgb,currentColor 20%,transparent)}.cat-button:active{transform:scale(.98)}.cat-button.primary{color:white;border-color:transparent;background:linear-gradient(135deg,#647ee8,#8576e3);box-shadow:0 10px 28px #6f74df3d}.cat-button.danger{color:#ffadb4}
      .cat-overview-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(300px,.7fr);gap:18px;margin-bottom:18px}.cat-team-overview,.cat-state-overview,.cat-members-panel{border-radius:28px}.cat-team-overview,.cat-state-overview{min-height:292px;padding:24px}.cat-panel-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:17px}.cat-panel-head h2{margin:0;font-size:17px;letter-spacing:-.015em}.cat-panel-meta{color:var(--cat-muted);font-size:12px}.cat-team-list{display:grid;gap:8px}.cat-team-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:13px;width:100%;box-sizing:border-box;border:1px solid color-mix(in srgb,currentColor 7%,transparent);border-radius:18px;background:color-mix(in srgb,currentColor 3.5%,transparent);color:inherit;padding:10px 12px;text-align:left;cursor:pointer;transition:background .15s ease,border-color .15s ease,transform .15s ease}.cat-team-row:hover{background:color-mix(in srgb,currentColor 6%,transparent);border-color:color-mix(in srgb,currentColor 13%,transparent);transform:translateY(-1px)}.cat-team-symbol{display:grid;width:38px;height:38px;place-items:center;border-radius:13px;color:#e8eaff;background:linear-gradient(145deg,color-mix(in srgb,var(--cat-blue) 27%,transparent),color-mix(in srgb,#d59ab6 14%,transparent));font-weight:730}.cat-team-name,.cat-team-fact{display:block}.cat-team-name{font-weight:660}.cat-team-fact{margin-top:2px;color:var(--cat-muted);font-size:11px}.cat-avatar-stack{display:flex;padding-left:7px}.cat-avatar-stack .cat-avatar{margin-left:-7px;border:2px solid color-mix(in srgb,var(--background-primary,#151515) 90%,transparent);box-sizing:border-box}.cat-team-arrow{color:var(--cat-muted);font-size:18px}.cat-team-list-empty{display:grid;min-height:210px;place-items:center;color:var(--cat-muted);text-align:center}
      .cat-state-overview{display:flex;flex-direction:column}.cat-state-body{display:grid;grid-template-columns:minmax(150px,1fr) minmax(120px,.72fr);align-items:center;gap:16px;flex:1}.cat-state-ring{--cat-running-angle:0deg;display:grid;width:150px;aspect-ratio:1;place-items:center;justify-self:center;border-radius:50%;background:conic-gradient(var(--cat-blue) var(--cat-running-angle),color-mix(in srgb,currentColor 8%,transparent) 0);box-shadow:0 12px 38px color-mix(in srgb,var(--cat-blue) 18%,transparent)}.cat-state-ring:before{content:"";grid-area:1/1;width:116px;aspect-ratio:1;border-radius:50%;background:color-mix(in srgb,var(--background-primary,#151515) 92%,#fff 4%);border:1px solid color-mix(in srgb,#fff 9%,transparent);box-shadow:inset 0 1px 16px #0002}.cat-ring-copy{grid-area:1/1;z-index:1;text-align:center}.cat-ring-value{font-size:30px;font-weight:720;letter-spacing:-.05em}.cat-ring-label{margin-top:1px;color:var(--cat-muted);font-size:11px}.cat-state-facts{display:grid;gap:13px}.cat-state-fact{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;color:var(--cat-muted);font-size:12px}.cat-state-swatch{width:8px;height:8px;border-radius:50%;background:currentColor}.cat-state-fact.waiting{color:var(--cat-amber)}.cat-state-fact.idle{color:var(--cat-green)}.cat-state-fact.offline{color:var(--cat-muted)}.cat-state-count{color:var(--text-primary,#eee);font-weight:650}
      .cat-members-panel{padding:24px}.cat-member-groups{display:grid}.cat-member-group{scroll-margin-top:24px;padding:22px 0;border-top:1px solid var(--cat-line)}.cat-member-group:first-child{padding-top:0;border-top:0}.cat-member-group:last-child{padding-bottom:0}.cat-member-group-head{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:13px}.cat-member-group-title{display:flex;align-items:baseline;gap:9px}.cat-member-group-title h3{margin:0;font-size:15px}.cat-member-group-title span{color:var(--cat-muted);font-size:11px}.cat-team-actions{opacity:.25;transition:opacity .15s ease}.cat-member-group:hover .cat-team-actions,.cat-team-actions:focus-within{opacity:1}.cat-member-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}.cat-member-tile{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:center;min-height:78px;box-sizing:border-box;border:1px solid color-mix(in srgb,currentColor 7%,transparent);border-radius:19px;background:linear-gradient(145deg,color-mix(in srgb,currentColor 4.5%,transparent),color-mix(in srgb,currentColor 2%,transparent));padding:12px;cursor:pointer;overflow:hidden;transition:background .15s ease,border-color .15s ease,transform .15s ease}.cat-member-tile:hover{background:color-mix(in srgb,currentColor 7%,transparent);border-color:color-mix(in srgb,var(--cat-blue) 30%,transparent);transform:translateY(-1px)}.cat-member-copy{min-width:0}.cat-member-name{font-weight:670;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cat-member-role{margin:2px 0 7px;color:var(--cat-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cat-runtime-text{display:inline-flex;align-items:center;gap:7px;color:var(--cat-muted);font-size:11px;white-space:nowrap}.cat-runtime-text:before{content:"";width:7px;height:7px;border-radius:99px;background:currentColor;box-shadow:0 0 0 4px color-mix(in srgb,currentColor 10%,transparent)}.cat-runtime-text.running{color:var(--cat-blue)}.cat-runtime-text.running:before{animation:catPulse 1.6s ease-in-out infinite}.cat-runtime-text.waiting{color:var(--cat-amber)}.cat-runtime-text.idle{color:var(--cat-green)}.cat-member-actions{position:absolute;inset:auto 8px 8px auto;padding:4px;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:10px;background:color-mix(in srgb,var(--background-primary,#151515) 88%,transparent);opacity:0;transform:translateY(3px);transition:opacity .14s ease,transform .14s ease;backdrop-filter:blur(10px)}.cat-member-tile:hover .cat-member-actions,.cat-member-actions:focus-within{opacity:1;transform:none}.cat-text-action{border:0;border-radius:7px;background:transparent;color:var(--cat-muted);padding:4px 6px;cursor:pointer;font-size:10px}.cat-text-action:hover{color:inherit;background:color-mix(in srgb,currentColor 8%,transparent)}.cat-team-empty{grid-column:1/-1;padding:28px;color:var(--cat-muted);font-size:12px;text-align:center}.cat-empty{border-radius:28px;padding:74px 24px;text-align:center}.cat-empty h3{margin:0 0 6px;font-size:18px}.cat-empty p{margin:0 0 18px;color:var(--cat-muted)}.cat-error,.cat-notice{margin-bottom:14px;padding:10px 12px;border-radius:12px;font-size:12px}.cat-error{background:#ff626218;color:#ffadb4}.cat-notice{background:color-mix(in srgb,var(--cat-green) 13%,transparent);color:#8ee0bd}
      .cat-team-directory{overflow:hidden;border-radius:24px}.cat-team-directory-head{display:flex;align-items:center;justify-content:space-between;padding:19px 22px;border-bottom:1px solid var(--cat-line)}.cat-team-directory-head h2{margin:0;font-size:16px}.cat-team-directory-row{display:grid;grid-template-columns:minmax(160px,.7fr) minmax(0,1fr) auto auto;align-items:center;gap:18px;width:100%;border:0;border-bottom:1px solid color-mix(in srgb,currentColor 7%,transparent);background:transparent;color:inherit;padding:15px 22px;text-align:left;cursor:pointer;transition:background .16s ease}.cat-team-directory-row:last-child{border-bottom:0}.cat-team-directory-row:hover{background:color-mix(in srgb,currentColor 4%,transparent)}.cat-team-directory-name{font-weight:670;letter-spacing:-.01em}.cat-member-carousel{display:flex;min-width:0;gap:8px;overflow-x:auto;overscroll-behavior-inline:contain;padding:5px 1px;scroll-snap-type:inline proximity;scrollbar-width:none}.cat-member-carousel::-webkit-scrollbar{display:none}.cat-member-avatar-ring{display:grid;width:42px;height:42px;place-items:center;flex:0 0 auto;border-radius:50%;padding:2px;box-sizing:border-box;background:#7c8798;scroll-snap-align:start}.cat-member-avatar-ring .cat-avatar{width:100%!important;height:100%!important;border:2px solid var(--background-primary,#151515);box-sizing:border-box}.cat-member-avatar-ring.waiting{background:#e6a15e;animation:catWaitingPulse 1.9s ease-in-out infinite}.cat-member-avatar-ring.running{background:conic-gradient(from 10deg,#8681f3 0 28%,#394269 28% 48%,#8681f3 48% 76%,#394269 76% 100%);animation:catRunningRing 2.4s linear infinite}.cat-team-state{min-width:66px;color:#94a0b2;font-size:12px;white-space:nowrap}.cat-team-state.waiting{color:var(--cat-amber)}.cat-team-state.running{color:var(--cat-blue)}.cat-team-chevron{color:var(--cat-muted);font-size:19px}.cat-team-detail{border-radius:24px;padding:22px}.cat-detail-top{display:flex;align-items:center;justify-content:space-between;gap:15px;padding-bottom:18px;border-bottom:1px solid var(--cat-line)}.cat-detail-back{border:0;background:transparent;color:var(--cat-muted);padding:0;cursor:pointer;font:inherit}.cat-detail-title{display:flex;align-items:center;gap:10px}.cat-detail-title h2{margin:0;font-size:19px}.cat-member-list{display:grid;margin-top:10px}.cat-member-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:13px;border-bottom:1px solid color-mix(in srgb,currentColor 7%,transparent);padding:13px 4px;cursor:pointer}.cat-member-row:last-child{border-bottom:0}.cat-member-row:hover{background:color-mix(in srgb,currentColor 3%,transparent)}.cat-member-row-actions{display:flex;gap:4px;opacity:0}.cat-member-row:hover .cat-member-row-actions,.cat-member-row-actions:focus-within{opacity:1}@keyframes catWaitingPulse{50%{box-shadow:0 0 0 5px color-mix(in srgb,#e6a15e 16%,transparent)}}@keyframes catRunningRing{to{transform:rotate(360deg)}}.cat-member-avatar-ring.running .cat-avatar{animation:catCounterRotate 2.4s linear infinite}@keyframes catCounterRotate{to{transform:rotate(-360deg)}}
      #codex-agent-team-modal{position:fixed;inset:0;z-index:90;display:grid;place-items:center;padding:22px;background:#0009;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}.cat-dialog{width:min(570px,100%);max-height:calc(100vh - 44px);overflow:auto;border-radius:24px;padding:23px}.cat-dialog h2{margin:0;font-size:20px;letter-spacing:-.02em}.cat-dialog-description{margin:6px 0 18px;color:var(--cat-muted);font-size:12px;line-height:1.6}.cat-field{display:grid;gap:6px;margin:12px 0}.cat-field label{font-size:11px;color:var(--cat-muted)}.cat-field input,.cat-field textarea,.cat-field select{width:100%;box-sizing:border-box;border:1px solid color-mix(in srgb,currentColor 11%,transparent);border-radius:12px;background:color-mix(in srgb,currentColor 3%,transparent);color:inherit;outline:0;padding:10px 11px;font:inherit}.cat-field input:focus,.cat-field textarea:focus,.cat-field select:focus{border-color:color-mix(in srgb,var(--cat-blue) 55%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--cat-blue) 10%,transparent)}.cat-field textarea{min-height:82px;resize:vertical}.cat-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.cat-avatar-presets{display:flex;flex-wrap:wrap;gap:8px}.cat-avatar-preset{display:grid;width:48px;height:48px;place-items:center;padding:2px;border:2px solid transparent;border-radius:50%;background:transparent;cursor:pointer}.cat-avatar-preset:hover{background:color-mix(in srgb,currentColor 7%,transparent)}.cat-avatar-preset[aria-pressed="true"]{border-color:var(--cat-blue)}.cat-avatar-preset img{width:40px;height:40px;border-radius:50%;object-fit:cover}
      @keyframes catPulse{50%{opacity:.45;transform:scale(.78)}}@media(max-width:980px){.cat-shell{padding-inline:24px}.cat-overview-grid{grid-template-columns:1fr}.cat-team-overview,.cat-state-overview{min-height:auto}.cat-member-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:680px){.cat-shell{padding:22px 16px 56px}.cat-dashboard-top,.cat-member-group-head{align-items:stretch;flex-direction:column}.cat-actions{align-self:flex-start;flex-wrap:wrap}.cat-state-body{grid-template-columns:1fr}.cat-team-row{grid-template-columns:auto minmax(0,1fr) auto}.cat-avatar-stack{display:none}.cat-member-grid{grid-template-columns:1fr}.cat-team-actions,.cat-member-actions{opacity:1}.cat-member-actions{position:static;grid-column:1/-1;justify-self:start;margin-top:2px;transform:none}.cat-member-tile{overflow:visible}}@media(prefers-reduced-motion:reduce){.cat-section-chevron,.cat-team-row,.cat-member-tile,.cat-runtime-text.running:before{transition:none;animation:none}}
    `;
    const refinements = document.createElement("style");
    refinements.id = "codex-agent-team-style-refinements";
    refinements.textContent = `
      #codex-agent-team-panel{--cat-blue:#0a84ff;--cat-green:#30d158;--cat-amber:#ff9f0a;--cat-red:#ff453a;--cat-muted:color-mix(in srgb,var(--text-primary,#f5f5f7) 54%,transparent);--cat-line:color-mix(in srgb,#fff 11%,transparent);isolation:isolate;background:radial-gradient(ellipse 65% 50% at 0% 0%,#3a72ad1d,transparent 72%),radial-gradient(ellipse 55% 45% at 100% 0%,#7a678f16,transparent 70%),color-mix(in srgb,var(--background-primary,#0f1013) 90%,#11151c);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",sans-serif}
      .cat-shell{max-width:1080px;padding:34px 38px 72px}.cat-panel-toolbar{display:flex;align-items:center;justify-content:space-between;gap:22px;margin:0 0 22px}.cat-brand{display:block}.cat-brand h1{margin:0;color:var(--text-primary,#f5f5f7);font-size:28px;font-weight:690;line-height:1.1;letter-spacing:-.035em}.cat-brand-meta{display:flex;align-items:center;gap:8px;margin-top:7px;color:var(--cat-muted);font-size:12px}.cat-brand-meta-separator{opacity:.45}.cat-connection-state{display:inline-flex;align-items:center;gap:6px}.cat-connection-state:before{width:6px;height:6px;border-radius:50%;background:var(--cat-green);box-shadow:0 0 0 3px color-mix(in srgb,var(--cat-green) 13%,transparent);content:""}.cat-connection-state.disconnected:before{background:var(--cat-red);box-shadow:0 0 0 3px color-mix(in srgb,var(--cat-red) 13%,transparent)}.cat-actions{gap:7px}.cat-button{min-height:34px;border:0;background:color-mix(in srgb,#fff 8%,transparent);box-shadow:inset 0 0 0 1px #ffffff0e;color:var(--text-primary,#f5f5f7);border-radius:10px;padding:7px 12px;font-size:12px;font-weight:570;transition:background .12s ease,transform .08s ease}.cat-button:hover{background:color-mix(in srgb,#fff 13%,transparent)}.cat-button:active{transform:scale(.97)}.cat-button.primary{background:var(--cat-blue);box-shadow:0 5px 18px #0a84ff38;color:#fff}.cat-button.primary:hover{background:#2794ff}.cat-button.tertiary{background:transparent;box-shadow:none;color:var(--cat-muted)}.cat-button:focus-visible,.cat-team-directory-row:focus-visible,.cat-team-expand-all:focus-visible,.cat-text-action:focus-visible{outline:3px solid color-mix(in srgb,var(--cat-blue) 40%,transparent);outline-offset:2px}
      .cat-glass{border:1px solid color-mix(in srgb,#fff 13%,transparent);background:linear-gradient(145deg,color-mix(in srgb,#fff 8%,transparent),color-mix(in srgb,#fff 3.5%,transparent));box-shadow:0 24px 70px #00000035,inset 0 1px 0 #ffffff1f;backdrop-filter:blur(38px) saturate(150%);-webkit-backdrop-filter:blur(38px) saturate(150%)}
      .cat-team-directory{overflow:clip;border-radius:18px}.cat-team-expand-all{border:0;background:transparent;color:var(--cat-muted);padding:7px 8px;font:570 12px/1.3 inherit;cursor:pointer}.cat-team-expand-all:hover{color:var(--text-primary,#f5f5f7)}
      .cat-team-directory-group{border-bottom:1px solid var(--cat-line)}.cat-team-directory-group:last-child{border-bottom:0}.cat-team-directory-row{grid-template-columns:minmax(180px,.7fr) minmax(0,1fr) auto 20px;gap:18px;padding:16px 20px;border:0;border-radius:0;background:transparent}.cat-team-directory-row:hover{background:color-mix(in srgb,#fff 4.5%,transparent)}.cat-team-directory-row[aria-expanded="true"]{background:color-mix(in srgb,#fff 3.2%,transparent)}.cat-team-directory-name{font-size:14px;font-weight:620;letter-spacing:-.012em}.cat-member-carousel{gap:7px;padding:3px 1px}.cat-member-avatar-ring{width:38px;height:38px;padding:2px;background:#798494;box-shadow:0 0 0 1px #ffffff19}.cat-member-avatar-ring .cat-avatar{border-color:color-mix(in srgb,var(--background-primary,#111) 88%,transparent)}.cat-member-avatar-ring.idle{background:#7d8795}.cat-member-avatar-ring.waiting{background:var(--cat-amber);box-shadow:0 0 0 1px #ffffff24,0 0 14px color-mix(in srgb,var(--cat-amber) 24%,transparent)}.cat-member-avatar-ring.running{background:conic-gradient(from 20deg,var(--cat-blue) 0 30%,#284f73 30% 48%,#62adff 48% 76%,#284f73 76%);box-shadow:0 0 0 1px #ffffff1b,0 0 14px #0a84ff2b}.cat-team-state{min-width:92px;color:#8b95a4;font-size:12px;font-weight:560;text-align:right}.cat-team-state.waiting{color:var(--cat-amber)}.cat-team-state.running{color:var(--cat-blue)}.cat-team-chevron{display:grid;width:20px;height:20px;place-items:center;color:var(--cat-muted)}.cat-team-chevron-icon{width:15px;height:15px;transition:transform .18s ease}.cat-team-directory-row[aria-expanded="true"] .cat-team-chevron-icon{transform:rotate(180deg)}
      .cat-team-directory-members{margin:0;padding:0 20px 8px;background:color-mix(in srgb,#000 8%,transparent)}.cat-team-directory-members[hidden]{display:none}.cat-team-inline-actions{display:flex;justify-content:flex-end;gap:2px;padding:8px 0 3px}.cat-text-action{border:0;border-radius:7px;background:transparent;color:var(--cat-muted);padding:5px 7px;font-size:11px;font-weight:540;cursor:pointer}.cat-text-action:hover{color:var(--text-primary,#f5f5f7);background:color-mix(in srgb,#fff 7%,transparent)}.cat-member-list{margin:0}.cat-member-row{grid-template-columns:auto minmax(0,1fr) auto auto;gap:12px;padding:12px 4px;border-color:var(--cat-line);border-radius:0}.cat-member-row:hover{background:color-mix(in srgb,#fff 3.5%,transparent)}.cat-member-name{font-weight:610}.cat-member-role{margin:2px 0 0;line-height:1.35}.cat-runtime-text{font-weight:550}.cat-runtime-text.running{color:var(--cat-blue)}.cat-runtime-text.waiting{color:var(--cat-amber)}.cat-runtime-text.idle{color:#8b95a4}.cat-member-row-actions{gap:2px}.cat-team-empty{padding:25px}.cat-empty{padding:68px 24px}.cat-empty h3{font-size:17px}.cat-notice{border:1px solid color-mix(in srgb,var(--cat-green) 25%,transparent);background:color-mix(in srgb,var(--cat-green) 9%,transparent);color:#9fe5b1}
      @media(max-width:760px){.cat-shell{padding:24px 16px 52px}.cat-panel-toolbar{align-items:flex-start;flex-direction:column}.cat-actions{width:100%;flex-wrap:wrap}.cat-team-directory-row{grid-template-columns:minmax(112px,.7fr) minmax(0,1fr) auto 18px;gap:10px;padding:13px 14px}.cat-member-avatar-ring{width:34px;height:34px}.cat-member-row-actions{opacity:1}.cat-member-row{grid-template-columns:auto minmax(0,1fr) auto}.cat-member-row-actions{grid-column:2/-1;justify-self:start}.cat-team-directory-members{padding-inline:12px}}
      @media(prefers-reduced-motion:reduce){.cat-member-avatar-ring.waiting,.cat-member-avatar-ring.running,.cat-member-avatar-ring.running .cat-avatar{animation:none}.cat-team-chevron-icon,.cat-button{transition:none}}
      @media(prefers-reduced-transparency:reduce){#codex-agent-team-panel{background:var(--background-primary,#111)}.cat-glass{background:color-mix(in srgb,var(--background-primary,#111) 94%,#fff);backdrop-filter:none;-webkit-backdrop-filter:none}}
    `;
    document.head.append(style, refinements);
  }

  function restoreProject(projectId) {
    const origin = state.projectOrigins.get(projectId);
    if (!origin?.wrapper?.isConnected || !origin.parent?.isConnected) {
      state.projectOrigins.delete(projectId);
      return;
    }
    if (origin.next?.parentElement === origin.parent) origin.parent.insertBefore(origin.wrapper, origin.next);
    else origin.parent.appendChild(origin.wrapper);
    origin.wrapper.removeAttribute("data-codex-agent-team-native-project");
    state.projectOrigins.delete(projectId);
  }

  function ensureNativeProjectsMounted() {
    const missing = state.snapshot.teams.some((team) => !nativeProjectWrapper(team.projectId ?? team.id));
    if (!missing) return;
    const projects = sectionContainer(exactLeaf(["项目", "Projects"]));
    const toggle = projects?.querySelector("[data-app-action-sidebar-section-toggle]");
    if (toggle?.getAttribute("aria-expanded") === "false") toggle.click();
  }

  function moveNativeProjects(body) {
    const desired = new Set(state.snapshot.teams.map((team) => team.projectId ?? team.id));
    for (const projectId of [...state.projectOrigins.keys()]) {
      if (!desired.has(projectId)) restoreProject(projectId);
    }
    ensureNativeProjectsMounted();
    for (const team of state.snapshot.teams) {
      const projectId = team.projectId ?? team.id;
      const wrapper = nativeProjectWrapper(projectId);
      if (!wrapper || wrapper.parentElement === body) continue;
      state.projectOrigins.set(projectId, {
        wrapper,
        parent: wrapper.parentElement,
        next: wrapper.nextElementSibling
      });
      wrapper.setAttribute("data-codex-agent-team-native-project", projectId);
      body.appendChild(wrapper);
    }
  }

  function renderSidebar() {
    let root = document.querySelector("[data-codex-agent-team-section]");
    if (!root) {
      root = document.createElement("section");
      root.setAttribute("data-codex-agent-team-section", "true");
      root.setAttribute("data-app-action-sidebar-section", "");
      root.setAttribute("data-app-action-sidebar-section-heading", t("teams"));
      root.className = "relative px-row-x";
      const head = document.createElement("div");
      head.className = "cat-section-head";
      const title = document.createElement("button");
      title.className = "cat-section-title";
      title.innerHTML = `<span>${t("teams")}</span>${chevronSvg("cat-section-chevron")}`;
      state.sectionExpanded ??= true;
      title.setAttribute("aria-expanded", String(state.sectionExpanded));
      const manage = document.createElement("button");
      manage.className = "cat-manage";
      manage.textContent = t("manage");
      manage.onclick = showPanel;
      const body = document.createElement("div");
      body.className = "cat-section-body";
      body.hidden = !state.sectionExpanded;
      title.onclick = () => {
        state.sectionExpanded = !state.sectionExpanded;
        title.setAttribute("aria-expanded", String(state.sectionExpanded));
        body.hidden = !state.sectionExpanded;
      };
      head.append(title, manage);
      root.append(head, body);
      const recent = sectionContainer(exactLeaf(["最近", "Recent"]));
      const projects = sectionContainer(exactLeaf(["项目", "Projects"]));
      if (recent?.parentElement) recent.insertAdjacentElement("beforebegin", root);
      else if (projects?.parentElement) projects.insertAdjacentElement("afterend", root);
      else return false;
    }
    const title = root.querySelector(".cat-section-title");
    const manage = root.querySelector(".cat-manage");
    const body = root.querySelector(".cat-section-body");
    root.setAttribute("data-app-action-sidebar-section-heading", t("teams"));
    const titleText = title?.querySelector("span");
    if (titleText) titleText.textContent = t("teams");
    if (manage) {
      manage.textContent = t("manage");
      manage.onclick = showPanel;
    }
    if (title && body) {
      title.setAttribute("aria-expanded", String(state.sectionExpanded));
      body.hidden = !state.sectionExpanded;
      title.onclick = () => {
        state.sectionExpanded = !state.sectionExpanded;
        title.setAttribute("aria-expanded", String(state.sectionExpanded));
        body.hidden = !state.sectionExpanded;
      };
    }
    moveNativeProjects(body);
    decorateNativeMemberRows(document, state.snapshot.teams);
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
    const rank = { waiting: 0, running: 1, idle: 2, offline: 3 };
    const memberStatus = (member) => member.status === "offline" ? "idle" : (member.status ?? "idle");
    const teamStatus = (team) => {
      const statuses = team.members.map(memberStatus);
      return statuses.includes("waiting") ? "waiting"
        : statuses.includes("running") ? "running"
          : "idle";
    };
    teams.sort((left, right) => rank[teamStatus(left)] - rank[teamStatus(right)] || left.name.localeCompare(right.name, clientLocale()));
    state.expandedTeamIds ??= new Set();
    const toolbar = document.createElement("div");
    toolbar.className = "cat-panel-toolbar";
    const brand = document.createElement("div");
    brand.className = "cat-brand";
    const brandTitle = document.createElement("h1");
    brandTitle.textContent = "AgentTeam";
    const brandMeta = document.createElement("div");
    brandMeta.className = "cat-brand-meta";
    const teamCount = document.createElement("span");
    teamCount.textContent = t("teamCount", { count: new Intl.NumberFormat(clientLocale()).format(teams.length) });
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
    const allExpanded = teams.length > 0 && teams.every((team) => state.expandedTeamIds.has(team.id));
    expandAll.textContent = t(allExpanded ? "collapseAll" : "expandAll");
    expandAll.onclick = () => {
      state.expandedTeamIds = allExpanded ? new Set() : new Set(teams.map((team) => team.id));
      showPanel();
    };
    const create = document.createElement("button");
    create.className = "cat-button primary";
    create.textContent = t("newTeam");
    create.onclick = () => showTeamForm();
    const stop = document.createElement("button");
    stop.className = "cat-button";
    stop.textContent = t("stopMode");
    stop.onclick = () => showConfirmation({
      title: t("stopTitle"),
      description: t("stopDescription"),
      confirmText: t("stopMode"),
      action: { type: "closeMode" }
    });
    const close = document.createElement("button");
    close.className = "cat-button tertiary";
    close.textContent = t("back");
    close.onclick = closePanel;
    actions.append(expandAll, stop, create, close);
    toolbar.append(brand, actions);
    shell.append(toolbar);
    if (state.snapshot.error) {
      const error = document.createElement("div");
      error.className = "cat-error";
      error.textContent = state.snapshot.error;
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
      const expanded = state.expandedTeamIds.has(team.id);
      const group = document.createElement("article");
      group.className = "cat-team-directory-group";
      const row = document.createElement("button");
      row.type = "button";
      row.className = "cat-team-directory-row";
      row.setAttribute("aria-expanded", String(expanded));
      row.setAttribute("aria-controls", `cat-team-members-${team.id}`);
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
        if (expanded) state.expandedTeamIds.delete(team.id);
        else state.expandedTeamIds.add(team.id);
        showPanel();
      };
      const members = document.createElement("div");
      members.id = `cat-team-members-${team.id}`;
      members.className = "cat-team-directory-members";
      members.hidden = !expanded;
      const memberActions = document.createElement("div");
      memberActions.className = "cat-team-inline-actions";
      for (const [text, handler] of [[t("addMember"), () => showMemberForm(team)], [t("editTeam"), () => showTeamForm(team)], [t("removeTeam"), () => showConfirmation({ title: t("removeTeamTitle", { name: team.name }), description: t("removeTeamDescription"), confirmText: t("removeTeam"), action: { type: "deleteTeam", teamId: team.id } })]]) {
        const button = document.createElement("button");
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
        memberRow.append(avatarRing(member, 42));
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
        for (const [text, handler] of [["CLI", async () => {
          const quote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;
          const transport = state.snapshot.transportUrl
            ? ` CODEX_APP_SERVER_WS_URL=${quote(state.snapshot.transportUrl)}`
            : "";
          const command = `CODEX_APP_SERVER_USE_LOCAL_DAEMON=1${transport} codex -C ${quote(member.cwd)} resume ${quote(member.threadId)}`;
          try {
            await navigator.clipboard.writeText(command);
            state.notice = t("cliCopied", { name: member.name });
          } catch {
            state.notice = t("cliFailed", { command });
          }
          showPanel();
        }], [t("edit"), () => showMemberForm(team, member)], [t("removeMember"), () => showConfirmation({ title: t("removeMemberTitle", { name: member.name }), description: t("removeMemberDescription"), confirmText: t("removeMember"), action: { type: "deleteMember", teamId: team.id, memberId: member.id } })]]) {
          const button = document.createElement("button");
          button.className = "cat-text-action";
          button.textContent = text;
          button.onclick = (event) => { event.stopPropagation(); handler(); };
          rowActions.append(button);
        }
        memberRow.append(copy, runtimeText(member), rowActions);
        memberRow.onclick = () => openThread(team.id, member);
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

  function modal(titleText, descriptionText = "") {
    document.querySelector("#codex-agent-team-modal")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "codex-agent-team-modal";
    const dialog = document.createElement("form");
    dialog.className = "cat-dialog cat-glass";
    const title = document.createElement("h2");
    title.textContent = titleText;
    dialog.append(title);
    if (descriptionText) {
      const description = document.createElement("p");
      description.className = "cat-dialog-description";
      description.textContent = descriptionText;
      dialog.append(description);
    }
    overlay.append(dialog);
    document.body.append(overlay);
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
    return { overlay, dialog };
  }

  function field(dialog, labelText, type = "text", value = "") {
    const wrap = document.createElement("div");
    wrap.className = "cat-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = type === "textarea" ? document.createElement("textarea") : document.createElement("input");
    if (type !== "textarea") input.type = type;
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
        ? { type: "updateTeam", teamId: team.id, name: name.value }
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
    let selectedAvatarDataUrl = null;
    const presets = state.snapshot.builtInAvatars ?? [];
    if (presets.length) {
      const presetField = document.createElement("div");
      presetField.className = "cat-field";
      const presetLabel = document.createElement("label");
      presetLabel.textContent = t("builtInAvatars");
      const presetGrid = document.createElement("div");
      presetGrid.className = "cat-avatar-presets";
      for (const preset of presets) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cat-avatar-preset";
        button.title = preset.name;
        button.setAttribute("aria-label", preset.name);
        button.setAttribute("aria-pressed", "false");
        const image = document.createElement("img");
        image.src = preset.dataUrl;
        image.alt = "";
        button.append(image);
        button.onclick = () => {
          selectedAvatarDataUrl = preset.dataUrl;
          presetGrid.querySelectorAll(".cat-avatar-preset").forEach((candidate) =>
            candidate.setAttribute("aria-pressed", String(candidate === button))
          );
        };
        presetGrid.append(button);
      }
      presetField.append(presetLabel, presetGrid);
      dialog.append(presetField);
    }
    const avatarInput = field(dialog, t("avatarImage"), "file");
    avatarInput.accept = "image/*";
    avatarInput.onchange = () => {
      if (!avatarInput.files?.length) return;
      selectedAvatarDataUrl = null;
      dialog.querySelectorAll(".cat-avatar-preset").forEach((candidate) =>
        candidate.setAttribute("aria-pressed", "false")
      );
    };
    const project = member ? null : field(dialog, t("projectPath"), "text", "");
    const model = field(dialog, t("model"), "text", member?.model ?? "");
    const effortWrap = document.createElement("div");
    effortWrap.className = "cat-field";
    const effortLabel = document.createElement("label");
    effortLabel.textContent = t("reasoning");
    const effortSelect = document.createElement("select");
    effortSelect.innerHTML = `<option value="">${t("defaultOption")}</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option>`;
    effortWrap.append(effortLabel, effortSelect);
    const effort = effortSelect;
    effort.value = member?.reasoningEffort ?? "";
    dialog.append(effortWrap);
    dialogActions(dialog, overlay, t(member ? "save" : "createMember"));
    dialog.onsubmit = async (event) => {
      event.preventDefault();
      let avatarDataUrl = selectedAvatarDataUrl;
      const file = avatarInput.files?.[0];
      if (!avatarDataUrl && file) avatarDataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      send(member ? {
        type: "updateMember",
        teamId: team.id,
        memberId: member.id,
        name: name.value,
        role: role.value,
        model: model.value,
        reasoningEffort: effort.value,
        ...(avatarDataUrl ? { avatarDataUrl } : {})
      } : {
        type: "createMember",
        teamId: team.id,
        name: name.value,
        role: role.value,
        projectSource: project.value,
        model: model.value,
        reasoningEffort: effort.value,
        ...(avatarDataUrl ? { avatarDataUrl } : {})
      });
      overlay.remove();
    };
    name.focus();
  }

  ensureStyles();
  renderSidebar();
  if (document.querySelector("#codex-agent-team-panel")) showPanel();
  if (!state.onDocumentNavigation) {
    state.onDocumentNavigation = (event) => {
      const target = event.target?.closest?.("[data-app-action-sidebar-thread-row]");
      if (!target) return;
      const panel = document.querySelector("#codex-agent-team-panel");
      if (panel) closePanel();
      if (!target.closest?.("[data-codex-agent-team-section]")) return;
      const nestedControl = event.target?.closest?.("button,a,[role='button']");
      if (nestedControl && nestedControl !== target && target.contains(nestedControl)) return;
      const found = memberForThreadRow(target);
      if (!found) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      send({ type: "navigateMember", teamId: found.team.id, memberId: found.member.id });
    };
    document.addEventListener("click", state.onDocumentNavigation, true);
    document.documentElement.setAttribute("data-codex-agent-team-document-navigation", "true");
  }
  if (!state.onPanelWindowResize) {
    state.onPanelWindowResize = syncPanelBounds;
    window.addEventListener("resize", state.onPanelWindowResize);
  }
  if (!state.observer) {
    let scheduled = false;
    state.observer = new MutationObserver((records) => {
      const missing = !document.querySelector("[data-codex-agent-team-section]");
      const nativeProjectChanged = records.some((record) => {
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        if (target?.closest?.("[data-codex-agent-team-section]")) return false;
        return [...(record.addedNodes ?? []), ...(record.removedNodes ?? [])].some((node) =>
          node?.nodeType === 1 && (
            node.matches?.("[data-sidebar-project-kind]") ||
            node.querySelector?.("[data-sidebar-project-kind]")
          )
        );
      });
      const nativeThreadChanged = records.some((record) => {
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        if (target?.closest?.("[data-codex-agent-team-native-project]")) return true;
        return [...(record.addedNodes ?? []), ...(record.removedNodes ?? [])].some((node) =>
          node?.nodeType === 1 && (
            node.matches?.("[data-app-action-sidebar-thread-row]")
            || node.querySelector?.("[data-app-action-sidebar-thread-row]")
          )
        );
      });
      if (scheduled || (!missing && !nativeProjectChanged && !nativeThreadChanged)) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; renderSidebar(); }, 30);
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
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
    decorateNativeMemberRows(document, []);
    for (const projectId of [...state.projectOrigins.keys()]) restoreProject(projectId);
    document.removeEventListener("click", state.onDocumentNavigation, true);
    state.onDocumentNavigation = null;
    window.removeEventListener("resize", state.onPanelWindowResize);
    state.onPanelWindowResize = null;
    document.documentElement.removeAttribute("data-codex-agent-team-document-navigation");
    document.querySelector("[data-codex-agent-team-section]")?.remove();
    closePanel();
    document.querySelector("#codex-agent-team-styles")?.remove();
  };
}
