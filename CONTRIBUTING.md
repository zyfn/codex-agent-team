# Contributing

Thanks for improving CodexAgentTeam.

Participation is governed by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Bundled media must follow [ASSETS.md](./ASSETS.md).

## Before opening a change

1. Keep the product model small: a Team maps to one native Codex Project and groups member Threads. Do not add task workflows, copied message history, or inferred completion state.
2. Preserve the ownership split: Codex owns Project identity, conversation history, cwd, models, and turn execution; this project owns Team registration, Member Directory preparation, and the optional Desktop projection.
3. Treat the CDP adapter as version-sensitive. Changes to selectors or injected UI need a real Codex Desktop check in addition to unit tests.
4. Keep Team transport direct and bounded. One Runtime owns one temporary official Codex App Server on a dynamic loopback endpoint. Never attach Team work to the user's shared daemon, add a custom App Server, fixed port, or message buffer.
5. `createRuntimeController()` is the lifecycle interface: `launch`, `status`, and internal `shutdown`. One launch creates one detached Runtime, one owned official App Server, and one independently-profiled Team Desktop. The ordinary Codex process is never inspected or closed.
6. Dashboard snapshots are read-only. Native Codex project reconciliation happens only at startup or after Team metadata changes.
7. Lifecycle changes must prove both directions: an active CodexAgentTeam Desktop has no stdio child; after Team Desktop exits, no CodexAgentTeam Runtime, process guard, Desktop, CDP connection, owned App Server, startup hook, or automatic relaunch behavior remains. A forced Runtime exit must release its owned children through the parent-control pipe.
8. Never set or clear global `launchctl` environment variables. Child processes receive a sanitized environment instead.
9. Treat `project/*` as an undocumented experimental capability of the official bundled App Server. Probe it before activation, isolate it behind CodexAgentTeam Manager, and fail closed when it changes.
10. Keep terminal integration optional and adapter-based. Ghostty and cmux are invoked only after a user click; do not add tmux, a terminal session database, or a resident terminal controller.

Changes to activation, process detection, session startup, or recovery behavior must explain their resource ownership and failure behavior in the pull request. Open an issue before making a large lifecycle change so maintainers can confirm the intended boundary.

## Source layout

`plugins/codex-agent-team/` is the installable plugin and the only runtime source tree. Tests import directly from it. Shared executable code belongs under the plugin-level `scripts/`; Skill folders contain workflow instructions, not runtime copies. Do not recreate a root `scripts/` mirror or duplicate bundled assets.

## Local checks

```sh
npm test
npm run check
npm run validate
python3 /path/to/plugin-creator/scripts/validate_plugin.py plugins/codex-agent-team
```

When changing the plugin bundle, update its cachebuster and reinstall it through the configured local marketplace. Test a real CodexAgentTeam launch only after the checks pass.

## Pull requests

- Explain user-visible behavior and any changes to the Team data shape.
- Add a focused test for any changed behavior.
- Do not commit local Team metadata, runtime logs, Team Directories, or Member Directories.
- Confirm the source and redistribution rights of any bundled image, font, or sound asset.
- State the Codex Desktop and bundled CLI versions used for manual CDP validation.
- For Desktop adapter changes, include manual evidence for the affected open, navigation, shutdown, or restart flow. Maintainers run the complete private Desktop matrix before release.
