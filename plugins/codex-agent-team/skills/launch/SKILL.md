---
name: launch
description: Launch the separate CodexAgentTeam desktop, report whether it is running, or diagnose a failed launch.
---

# Launch CodexAgentTeam

Resolve `<plugin-root>` as two directories above this `SKILL.md`, then choose one command from the user's intent.

- To enter or open CodexAgentTeam, run `launch`. It is idempotent and reports an existing Runtime instead of creating another one.
- For a status question, run `status` and report the result.
- For a launch failure or troubleshooting request, run `diagnose` once and summarize the failing check.

```sh
node "<plugin-root>/scripts/codex-agent-team.mjs" launch
node "<plugin-root>/scripts/codex-agent-team.mjs" status
node "<plugin-root>/scripts/codex-agent-team.mjs" diagnose
```

`launch` starts a separate Codex Desktop and returns only after CodexAgentTeam is ready. Then tell the user to use Command-Q to quit the current ordinary Codex and continue in the new window.

Do not show an internal command menu. Never kill or restart Codex, request another confirmation, or guess the plugin path from `$PWD`, `$CODEX_HOME`, or a cache version.
