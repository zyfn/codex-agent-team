---
name: collaborate
description: Inspect the current CodexAgentTeam membership or send one explicit message to a teammate in the same Team.
---

# Collaborate in CodexAgentTeam

Resolve `<plugin-root>` as two directories above this `SKILL.md` and run the launcher by absolute path.

When the target and message are already clear and no Team metadata is needed, send directly without a context lookup:

```text
node "<plugin-root>/scripts/codex-agent-team.mjs" collaborate send \
  --target "<member>" \
  --message "<message>"
```

Use context when the user asks who is in the Team, the valid target is unclear, or shared documents are involved:

```text
node "<plugin-root>/scripts/codex-agent-team.mjs" collaborate context
```

The context returns `team.sharedDirectory`, derived from the Team Directory. Write durable documents there with normal file tools. When a teammate needs one, send its absolute path, why it matters, and the expected action instead of copying the document into the message. Do not notify unrelated members.

Send once to one target. Include only required context, the expected deliverable, and whether a concise result or blocker reply is needed. Never retry an ambiguous submission automatically, broadcast, auto-forward, or create a reply chain.

Report only whether Codex accepted the native Turn submission; acceptance is not completion. If an incoming message requests a response, finish the work first and reply once to its named sender. Never inspect Team files or another member's directory; the launcher resolves current membership and rejects invalid routes.
