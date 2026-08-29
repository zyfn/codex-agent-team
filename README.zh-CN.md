<div align="center">

# CodexAgentTeam

### 一支由原生 Codex 会话组成的持久团队。

专家只创建一次。全局查看整支团队，进入任意原始会话，让成员协作，同时不替代 Codex。

[![CI](https://github.com/zyfn/codex-agent-team/actions/workflows/ci.yml/badge.svg)](https://github.com/zyfn/codex-agent-team/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)
![Status: Experimental](https://img.shields.io/badge/status-experimental-orange.svg)

[English](./README.md) · [更新记录](./CHANGELOG.md) · [参与贡献](./CONTRIBUTING.md) · [支持范围](./SUPPORT.md) · [安全策略](./SECURITY.md)

</div>

管理一段 Codex 会话很容易，管理一组专家却不容易：职责需要反复说明，上下文散落在多个标签页里，工作目录可能互相影响，逐个检查会话本身也变成了一项工作。

CodexAgentTeam 把原生 Codex 会话组织成长期存在的团队。每位成员保留自己的身份、职责、头像、独立目录和原始 Thread；全局 Dashboard 展示整支团队，并在需要判断时进入真正的会话。

> [!IMPORTANT]
> CodexAgentTeam 当前是 macOS 实验预览版。原生 Thread 与 App Server 事件始终是权威事实；全局 Desktop 入口目前依赖一层很小的、失败关闭的 CDP 适配器。

![AgentTeam Dashboard 展示一个 Team 与对应的原生 Codex 会话成员](./docs/assets/dashboard.png)

## 你会得到什么

| | 能力 | 对真实工作的改变 |
| --- | --- | --- |
| **01** | 持久成员 | 专家只定义一次，第二天继续同一条原生 Thread。 |
| **02** | 一个团队视图 | 不逐个打开聊天，也能看到所有 Team、成员和 Codex 待处理状态。 |
| **03** | 原始会话 | 点击成员继续使用 Codex 自己的历史、工具、审批和导航。 |
| **04** | 显式协作 | 一次只向一位成员提交一条有界消息，不恢复目标会话，也没有隐藏广播或 Agent 循环。 |
| **05** | 安全成员目录 | 从空目录开始、为本地 Git 创建 worktree，或把远程 Git 仓库克隆进 Team 管理的目录。 |

## 快速开始

### 环境要求

- macOS
- Node.js 22+
- Git
- Codex Desktop 安装在 `/Applications/Codex.app`

### 安装

```sh
codex plugin marketplace add zyfn/codex-agent-team
codex plugin add codex-agent-team@codex-agent-team
```

安装后重启 Codex，并创建一个新会话，让插件 Skills 被发现。

### 启动 CodexAgentTeam

调用 `$codex-agent-team:launch`，要求启动 CodexAgentTeam。Skill 完成兼容性检查后，会启动一个独立 Codex 窗口，并在其全局导航中加入 **AgentTeam** 入口。插件不会关闭或重启当前 Codex。

CodexAgentTeam 窗口准备完成后，使用 **Command-Q** 退出当前普通 Codex，再在 CodexAgentTeam 窗口继续工作。使用 **Command-Q** 退出 CodexAgentTeam Codex 后，本次临时官方 App Server 会结束并释放成员 Thread。Team、成员目录与原生 Thread 会继续保留，下一次可从 CodexAgentTeam 或普通 Codex 中继续。

### 创建 Team

1. 从全局导航打开 **AgentTeam**。
2. 创建一个 Team。
3. 为成员设置名称、职责、头像、初始模型配置和可选 Git 来源。
4. 点击成员，进入它的原始 Codex 会话。

创建成员时，CodexAgentTeam 会向新 Thread 写入一次身份和协作规则；后续工作不需要重新理解 Team 配置。

在成员会话中，`$codex-agent-team:collaborate` 可以一次返回当前成员的完整 Team 上下文，并向一位明确成员发送一条消息。

每个 Team 都有一个用户可见的 `shared` 目录，用于保存持久共享文档。成员直接使用原生文件工具读写；只有其他成员确实需要时，才发送文件绝对路径、用途和期望动作。

## 一次真实协作

```text
创建“发布团队”
  ├─ 产品 · 澄清目标与验收
  ├─ 后端 · 负责服务行为
  ├─ 前端 · 负责用户流程
  └─ 测试 · 验证最终结果

打开产品成员并给出目标
  → 产品显式联系后端和前端
  → Dashboard 反映 Codex 原生的运行 / 等待 / 空闲状态
  → 需要判断时，进入任意成员的原始会话
  → 让测试成员在自己的持久 Thread 中完成验收
```

这些角色只是示例，不是内置工作流。同一模型也适合调研、内容、运营，以及任何需要长期专家协作的工作。

## 产品模型

![CodexAgentTeam 在原生 Codex Project 与 Thread 之上增加轻量组织层](./docs/assets/native-team-model.svg)

- **一个 Team** 由一个原生 Codex Project 承载；`teamId` 就是该原生标识。
- **一位成员** 对应一条持久原生 Thread 和一个 Team 管理的成员目录；该目录可以是空目录、本地 Git worktree 或远程 Git clone。
- **一次协作** 是向一个明确目标发送一条消息。
- **一个 Dashboard** 投影 Codex 状态，不创造第二份事实来源。

系统没有 Task 数据库、Leader 生命周期、聊天记录副本、自定义 App Server 或第二套聊天 UI。

承载 Team 的 Project 身份和展示名称由 Codex 管理。CodexAgentTeam 只保存 `teamId`、一个稳定的 Team 目录和最小成员身份信息。每次进入 Dashboard 都从 Codex 读取当前 Team 名称、成员 cwd 与运行态，不重复持久化原生状态。

## 关键能力保持原生

| CodexAgentTeam 管理 | Codex 管理 |
| --- | --- |
| Team 注册关系与成员元数据 | Team 身份、名称、外观与 roots |
| 职责与头像 | Thread 历史与存储 |
| Team 与成员目录准备 | Turn、工具和审批 |
| 显式队友路由 | 模型与推理行为 |
| Dashboard 投影 | 运行态、会话渲染与导航 |

CodexAgentTeam 不修改 Codex SQLite、rollout 文件、`config.toml`、认证信息或 Thread 数据格式。移除成员时归档原生会话，并保留全部成员目录文件与 Git 分支。

## 可选终端视图

在 Dashboard 中选择 **Ghostty** 或 **cmux**，即可把同一批原生成员 Thread 放进一个标签页或工作区，并使用成员标题分屏。这只是 Team 的另一种视图，不是另一套 Session 模型。

Runtime 启动时只检测一次终端安装情况；未安装的应用会置灰。cmux 默认只接受其自身启动进程的控制命令。若要从 Codex Dashboard 使用 cmux 按钮，需要以 `CMUX_SOCKET_MODE=allowAll` 启动 cmux；这会允许同一 macOS 用户下的其他本地进程访问 cmux 控制 socket。不希望扩大本地访问范围时，请使用 Ghostty。

## 安全与兼容性

- 未选择 Git 来源时，在 Team 目录内创建一个以成员名称命名的空成员目录。
- 选择本地来源时必须是 Git 仓库；CodexAgentTeam 在成员目录中创建隔离 worktree，绝不直接使用源 checkout。
- 输入远程 Git 地址时，将仓库克隆到成员目录。
- 模型与推理配置只用于创建原生 Thread；后续变更与 Thread cwd 均由 Codex 管理。
- 移除成员只归档原生 Thread，不删除目录、worktree、分支或头像文件。
- 每次运行只管理自己启动的临时官方 Codex App Server，不触碰用户已有的共享 daemon。
- CodexAgentTeam Desktop 使用独立 Electron profile，不接管普通 Codex 窗口。
- CodexAgentTeam Desktop 退出时结束专属 App Server；本次连接的终端视图也随之断开。
- 端口和连接等待都有上限；CodexAgentTeam 不安装启动任务，也不拦截未来的 Codex 启动。
- Desktop 私有能力变化时，集成失败关闭。

信任边界见 [SECURITY.md](./SECURITY.md)，兼容承诺与问题清单见 [SUPPORT.md](./SUPPORT.md)，媒体授权见 [ASSETS.md](./ASSETS.md)。

## 数据与卸载

CodexAgentTeam 在 `~/.codex-agent-team/` 下保存 Team 注册、头像、成员目录和有界运行诊断。移除插件不会删除该目录或原生 Codex 会话。卸载前先使用 **Command-Q** 退出活动中的 CodexAgentTeam 窗口；确认不再需要后，再手动删除保留数据。

## 开发

`plugins/codex-agent-team/` 是唯一可安装运行源码。

```sh
npm test
npm run check
python3 /path/to/plugin-creator/scripts/validate_plugin.py plugins/codex-agent-team
```

生命周期或 CDP 改动除了自动测试，还必须执行真实 Codex Desktop 验收。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

[MIT](./LICENSE)
