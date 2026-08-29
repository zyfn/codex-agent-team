import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTeamUiExpression,
  chooseNativeDirectory,
  findNativeTopNavigationItem
} from "../plugins/codex-agent-team/scripts/lib/runtime/desktop/dashboard.mjs";

test("native directory selection returns only one path without enumerating files", async () => {
  const listeners = new Set();
  const calls = [];
  const hostWindow = {
    electronBridge: {
      async sendMessageFromView(message) {
        calls.push(message);
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener({ data: { type: "workspace-root-option-picked", root: "/tmp/project" } });
          }
        });
      }
    },
    addEventListener(type, listener) {
      assert.equal(type, "message");
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, "message");
      listeners.delete(listener);
    },
    setTimeout,
    clearTimeout
  };

  assert.equal(await chooseNativeDirectory(hostWindow), "/tmp/project");
  assert.deepEqual(calls, [{
    type: "electron-pick-workspace-root-option",
    allowMultiple: false
  }]);
  assert.equal(listeners.size, 0);
});

test("top navigation discovery uses the native Plugins row as its presentation template", () => {
  const plugins = { id: "plugins-button" };
  const document = {
    querySelectorAll(selector) {
      if (selector === 'a[href]') return [];
      assert.equal(selector, "span,div,p,a,button");
      return [{
        children: [],
        textContent: "Plugins",
        closest(target) {
          assert.equal(target, "button,a,[role=button]");
          return plugins;
        }
      }];
    }
  };

  assert.equal(findNativeTopNavigationItem(document), plugins);
});

test("top navigation discovery is locale-independent when Codex exposes its native skills route", () => {
  const plugins = {
    getAttribute(name) {
      assert.equal(name, "href");
      return "/skills";
    }
  };
  const document = {
    querySelectorAll(selector) {
      if (selector === 'a[href]') return [plugins];
      throw new Error(`Unexpected selector: ${selector}`);
    }
  };

  assert.equal(findNativeTopNavigationItem(document, ["未知语言"]), plugins);
});

test("top navigation discovery refuses an ambiguous or missing Plugins anchor", () => {
  const button = {};
  const document = {
    querySelectorAll() {
      const selector = arguments[0];
      if (selector === 'a[href]') return [];
      return [
        { children: [], textContent: "Plugins", closest: () => button },
        { children: [], textContent: "Plugins", closest: () => ({}) }
      ];
    }
  };
  assert.equal(findNativeTopNavigationItem(document), null);
});

test("CodexAgentTeam is a native-looking top-level navigation item and leaves Projects untouched", () => {
  const expression = buildTeamUiExpression({
    connectionStatus: "connected",
    teams: [{
      teamId: "team-1",
      name: "商业化团队",
      teamDirectory: "/tmp/team-project-1",
      members: [{
        id: "member-1",
        name: "前端",
        role: "负责前端",
        threadId: "thread-exact-1",
        status: "running",
        avatar: null
      }]
    }]
  }, "codexAgentTeamBridge");

  assert.match(expression, /data-codex-agent-team-nav/);
  assert.match(expression, /AgentTeam/);
  assert.match(expression, /send\(\{ type: "refresh" \}\);\s*showPanel\(\)/);
  assert.match(expression, /cloneNode\(true\)/);
  assert.match(expression, /insertAdjacentElement\("afterend", root\)/);
  assert.doesNotMatch(expression, /data-codex-agent-team-section/);
  assert.doesNotMatch(expression, /data-app-action-sidebar-section-heading/);
  assert.doesNotMatch(expression, /data-codex-agent-team-native-layout/);
  assert.doesNotMatch(expression, /installProjectsToggleGuard/);
  assert.doesNotMatch(expression, /allowNativeProjectsToggle/);
  assert.match(expression, /thread-exact-1/);
  assert.match(expression, /decorateNativeMemberRows/);
  assert.match(expression, /const retained = new Set\(\)/);
  assert.doesNotMatch(expression, /threadId\.endsWith/);
  assert.match(expression, /cat-brand-meta/);
  assert.match(expression, /cat-connection-state/);
  assert.match(expression, /document\.documentElement\.lang/);
  assert.match(expression, /navigator\.language/);
  assert.match(expression, /new MutationObserver/);
  assert.doesNotMatch(expression, /characterData:\s*true/);
  assert.doesNotMatch(expression, /attributeFilter:\s*\["class", "aria-expanded", "data-state"\]/);
  assert.match(expression, /node\.matches\?\.\("\[data-app-action-sidebar-thread-row\]"\)/);
  assert.match(expression, /attributeFilter:\s*\["lang"\]/);
  assert.match(expression, /send\(\{ type: "openMember"/);
  assert.doesNotMatch(expression, /const openThread = \(teamId, member\) => \{\s*closePanel\(\)/);
  assert.match(expression, /state\.closePanel = closePanel/);
  assert.match(expression, /Connected/);
  assert.match(expression, /已连接/);
  assert.match(expression, /New Team/);
  assert.doesNotMatch(expression, /cat-dashboard-top/);
  assert.match(expression, /cat-team-directory/);
  assert.match(expression, /cat-team-directory-row/);
  assert.match(expression, /cat-team-directory-members/);
  assert.match(expression, /cat-team-expand-all/);
  assert.match(expression, /openTeamTerminal/);
  assert.match(expression, /Open in…/);
  assert.match(expression, /在终端中打开…/);
  assert.match(expression, /Open in Ghostty/);
  assert.match(expression, /在 cmux 中打开/);
  assert.match(expression, /cat-terminal-menu/);
  assert.match(expression, /cat-terminal-menu-popover/);
  assert.match(expression, /cat-terminal-app-icon/);
  assert.match(expression, /terminalApplications/);
  assert.doesNotMatch(expression, /Open CLI/);
  assert.doesNotMatch(expression, /打开 CLI/);
  assert.match(expression, /Ghostty is not installed/);
  assert.match(expression, /未安装 cmux/);
  assert.match(expression, /expandedTeamIds/);
  assert.match(expression, /state\.expandedTeamIds \?\?= new Set\(\)/);
  assert.doesNotMatch(expression, /new Set\(\(snapshot\.teams \?\? \[\]\)\.map/);
  assert.match(expression, /group\.classList\.toggle\("expanded", expanded\)/);
  assert.doesNotMatch(expression, /pendingCompactGroup/);
  assert.match(expression, /if \(expanded\) \{\s*const members/);
  assert.match(expression, /aria-expanded/);
  assert.match(expression, /cat-member-carousel/);
  assert.match(expression, /cat-member-avatar-ring/);
  assert.match(expression, /cat-team-state/);
  assert.match(expression, /statusLabel\(teamStatus\(team\)\)/);
  assert.match(expression, /statuses\.every\(\(status\) => status === "offline"\)/);
  assert.doesNotMatch(expression, /cat-team-detail/);
  assert.match(expression, /overflow-x:\s*auto/);
  assert.doesNotMatch(expression, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(expression, /cat-team-directory-group\.wide/);
  assert.doesNotMatch(expression, /position:\s*sticky/);
  assert.match(expression, /error: 0, waiting: 1, running: 2, idle: 3, offline: 4/);
  assert.doesNotMatch(expression, /退出 CodexAgentTeam/);
  assert.match(expression, /backdrop-filter:\s*blur\(38px\)/);
  assert.match(expression, /编辑团队/);
  assert.match(expression, /移除团队/);
  assert.match(expression, /移除成员/);
  assert.doesNotMatch(expression, /CLI resume command copied/);
  assert.doesNotMatch(expression, /CODEX_APP_SERVER_WS_URL/);
  assert.doesNotMatch(expression, /CODEX_APP_SERVER_USE_LOCAL_DAEMON/);
  assert.match(expression, /cat-runtime-text/);
  assert.match(expression, /offline: "Offline"/);
  assert.match(expression, /error: "Error"/);
  assert.match(expression, /dismissError/);
  assert.match(expression, /state\.snapshot = \{ \.\.\.state\.snapshot, error: null \}/);
  assert.match(expression, /cat-error-dismiss/);
  assert.match(expression, /position:\s*fixed/);
  assert.match(expression, /document\.body\.append\(panel\)/);
  assert.match(expression, /getBoundingClientRect\(\)/);
  assert.doesNotMatch(expression, /main\.append\(panel\)/);
  assert.match(expression, /onNativeNavigation/);
  assert.match(expression, /document\.addEventListener\("click", state\.onNativeNavigation, true\)/);
  assert.match(expression, /document\.removeEventListener\("click", state\.onNativeNavigation, true\)/);
  assert.doesNotMatch(expression, /webkitdirectory/);
  assert.match(expression, /chooseNativeDirectory/);
  assert.doesNotMatch(expression, /getPathForFile/);
  assert.match(expression, /electron-pick-workspace-root-option/);
  assert.match(expression, /preparingMember/);
  assert.match(expression, /aria-busy/);
  assert.match(expression, /control !== memberActions\.cancel/);
  assert.doesNotMatch(expression, /field\(dialog, t\("projectPath"\), "text"/);
  assert.match(expression, /availableModels/);
  assert.match(expression, /model: "Initial model"/);
  assert.match(expression, /reasoning: "Initial reasoning"/);
  assert.match(expression, /model: "初始模型"/);
  assert.match(expression, /reasoning: "初始推理强度"/);
  assert.match(expression, /nextSnapshot\.availableModels \?\? state\.snapshot\?\.availableModels/);
  assert.match(expression, /supportedReasoningEfforts/);
  assert.doesNotMatch(expression, /field\(dialog, t\("model"\), "text"/);
  assert.doesNotMatch(expression, /<option value="low">low<\/option>/);
  assert.match(expression, /cat-avatar-source-toggle/);
  assert.match(expression, /inspectWorkingDirectory/);
  assert.doesNotMatch(expression, /cat-workspace-choice/);
  assert.match(expression, /cat-work-source-toggle/);
  assert.match(expression, /sourceMode/);
  assert.match(expression, /New empty folder/);
  assert.match(expression, /Local Git repository/);
  assert.match(expression, /Clone from Git URL/);
  assert.match(expression, /Member working directory/);
  assert.match(expression, /localSourcePanel\.hidden = sourceMode !== "local"/);
  assert.match(expression, /remoteSourcePanel\.hidden = sourceMode !== "remote"/);
  assert.doesNotMatch(expression, /Git repository \(optional\)/);
  assert.match(expression, /localGitDirectory/);
  assert.match(expression, /remoteGitUrl/);
  assert.match(expression, /localSourceHint/);
  assert.doesNotMatch(expression, /createWorktree/);
  assert.match(expression, /memberWorkingDirectory/);
  assert.match(expression, /avatarMode/);
  assert.match(expression, /matchingPreset/);
  assert.match(expression, /removeTeam/);
  assert.match(expression, /removeMember/);
  assert.match(expression, /renameTeam/);
  assert.doesNotMatch(expression, /target\.click\(\)/);
  assert.doesNotMatch(expression, /const language = \^\/\\\^zh/);
  assert.doesNotMatch(expression, /cat-dashboard-summary/);
  assert.doesNotMatch(expression, /teamPanelView/);
  assert.doesNotMatch(expression, /showLegacyPanel/);
  assert.doesNotMatch(expression, /confirm\(/);
  assert.doesNotMatch(expression, /cat-member-status/);
  assert.doesNotMatch(expression, /cat-live-wave/);
  assert.doesNotMatch(expression, /cat-native-placeholder/);
  assert.doesNotMatch(expression, /data-codex-agent-team-hidden/);
  assert.doesNotMatch(expression, /第一条工作消息/);
  assert.doesNotMatch(expression, /cat-dot/);
  assert.doesNotMatch(expression, />⌄</);
  assert.doesNotMatch(expression, /\["插件", "Plugins"\]/);
  assert.doesNotMatch(expression, /Live workspace/);
  assert.doesNotMatch(expression, /所有团队，一眼掌握/);
  assert.doesNotMatch(expression, /实时连接正常/);
  assert.doesNotMatch(expression, /cat-team-filter/);
  assert.doesNotMatch(expression, /cat-search/);
  assert.doesNotMatch(expression, /默认模型/);
  assert.doesNotMatch(expression, /默认推理/);
  assert.doesNotMatch(expression, /刚刚活跃/);
  assert.doesNotMatch(expression, /localeCompare\(right\.name, "zh-CN"\)/);
  assert.doesNotMatch(expression, /cat-directory-label/);
});
