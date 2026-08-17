import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTeamUiExpression,
  decorateNativeMemberRows
} from "../scripts/lib/desktop-ui.mjs";

test("Team member avatars decorate native thread rows without replacing native runtime status", () => {
  const document = nativeThreadFixture("local:thread-1");
  const nativeStatus = document.row.children[1];

  const teams = [{
    members: [{
      id: "member-1",
      name: "前端",
      threadId: "thread-1",
      avatar: "data:image/jpeg;base64,YXZhdGFy"
    }]
  }];

  decorateNativeMemberRows(document, teams);
  decorateNativeMemberRows(document, teams);

  const avatars = document.querySelectorAll("[data-codex-agent-team-member-avatar]");
  assert.equal(avatars.length, 1, "refreshing must not duplicate the avatar");
  assert.equal(avatars[0].children[0].src, "data:image/jpeg;base64,YXZhdGFy");
  assert.equal(document.row.children[1], nativeStatus, "the native status rail must stay untouched");
});

test("the injected Team section is anchored beside native sidebar sections and keeps exact thread ids", () => {
  const expression = buildTeamUiExpression({
    revision: 1,
    connectionStatus: "connected",
    teams: [{
      id: "team-1",
      projectId: "team-project-1",
      name: "商业化团队",
      cwd: "/tmp/team-project-1",
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

  assert.match(expression, /data-codex-agent-team-section/);
  assert.match(expression, /最近/);
  assert.match(expression, /Recent/);
  assert.match(expression, /thread-exact-1/);
  assert.match(expression, /data-app-action-sidebar-thread-row/);
  assert.match(expression, /data-app-action-sidebar-project-id/);
  assert.match(expression, /data-sidebar-project-kind/);
  assert.match(expression, /appendChild\(wrapper\)|append\(wrapper\)/);
  assert.match(expression, /管理/);
  assert.match(expression, /AgentTeam/);
  assert.match(expression, /cat-brand-meta/);
  assert.match(expression, /cat-connection-state/);
  assert.match(expression, /document\.documentElement\.lang/);
  assert.match(expression, /navigator\.language/);
  assert.match(expression, /new MutationObserver/);
  assert.match(expression, /attributeFilter:\s*\["lang"\]/);
  assert.match(expression, /send\(\{ type: "navigateMember"/);
  assert.match(expression, /Connected/);
  assert.match(expression, /已连接/);
  assert.match(expression, /New Team/);
  assert.match(expression, /cat-dashboard-top/);
  assert.match(expression, /cat-team-directory/);
  assert.match(expression, /cat-team-directory-row/);
  assert.match(expression, /cat-team-directory-members/);
  assert.match(expression, /cat-team-expand-all/);
  assert.match(expression, /expandedTeamIds/);
  assert.match(expression, /aria-expanded/);
  assert.match(expression, /cat-member-carousel/);
  assert.match(expression, /cat-member-avatar-ring/);
  assert.match(expression, /cat-team-state/);
  assert.match(expression, /statusLabel\(teamStatus\(team\)\)/);
  assert.match(expression, /cat-team-detail/);
  assert.match(expression, /overflow-x:auto/);
  assert.match(expression, /waiting: 0, running: 1, idle: 2, offline: 3/);
  assert.match(expression, /关闭模式/);
  assert.match(expression, /backdrop-filter:blur\(18px\)/);
  assert.match(expression, /编辑团队/);
  assert.match(expression, /移除团队/);
  assert.match(expression, /移除成员/);
  assert.match(expression, /CLI/);
  assert.match(expression, /CODEX_APP_SERVER_WS_URL/);
  assert.match(expression, /cat-runtime-text/);
  assert.match(expression, /data-codex-agent-team-document-navigation/);
  assert.match(expression, /position:fixed/);
  assert.match(expression, /document\.body\.append\(panel\)/);
  assert.match(expression, /getBoundingClientRect\(\)/);
  assert.doesNotMatch(expression, /main\.append\(panel\)/);
  assert.match(expression, /deleteTeam/);
  assert.match(expression, /deleteMember/);
  assert.match(expression, /updateTeam/);
  assert.doesNotMatch(expression, /cloneNode\(true\)/);
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

function nativeThreadFixture(threadId) {
  const row = new FakeNode("div");
  row.setAttribute("data-app-action-sidebar-thread-id", threadId);
  const nativeActions = new FakeNode("div");
  const nativeStatus = new FakeNode("div");
  nativeStatus.setAttribute("data-native-runtime-status", "running");
  const content = new FakeNode("div");
  const titleGroup = new FakeNode("div");
  const leadingSlot = new FakeNode("div");
  const title = new FakeNode("div");
  title.setAttribute("data-thread-title-trigger", "true");
  titleGroup.append(leadingSlot, title);
  content.append(titleGroup);
  row.append(nativeActions, nativeStatus, content);
  return new FakeDocument(row);
}

class FakeDocument {
  constructor(row) {
    this.row = row;
  }

  createElement(tagName) {
    return new FakeNode(tagName);
  }

  querySelectorAll(selector) {
    if (selector === "[data-codex-agent-team-section] [data-app-action-sidebar-thread-id],"
      + "[data-codex-agent-team-section] [data-thread-id]") return [this.row];
    return this.row.querySelectorAll(selector);
  }
}

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.parentElement = null;
    this.className = "";
    this.style = {};
    this.textContent = "";
  }

  get firstElementChild() {
    return this.children[0] ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (matches(child, selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
}

function matches(node, selector) {
  const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (!attribute) return false;
  if (!node.attributes.has(attribute[1])) return false;
  return attribute[2] === undefined || node.getAttribute(attribute[1]) === attribute[2];
}
