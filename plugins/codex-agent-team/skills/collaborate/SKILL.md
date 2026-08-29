---
name: collaborate
description: Work with members of the current CodexAgentTeam by inspecting Team context, sending a message, or replying to a teammate.
---

# Collaborate in CodexAgentTeam

Resolve `<plugin-root>` as two directories above this `SKILL.md` and run the launcher by absolute path.

Use this Skill only inside a CodexAgentTeam member conversation. Do not use ordinary Codex task or thread messaging tools to contact Team members.

When the target and message are clear, send directly:

```text
node "<plugin-root>/scripts/codex-agent-team.mjs" collaborate send \
  --target "<member>" \
  --message "<message>"
```

After a successful command, say only that the message was sent to the named member. Do not expose the command, JSON receipt, Turn ID, or transport semantics unless the user is diagnosing AgentTeam itself. If sending fails, state the concise reason and do not claim success. Do not wait for the recipient unless the user asked you to monitor or collect a response.

Use context when the user asks about the Team, the target is unclear, or shared documents are involved:

```text
node "<plugin-root>/scripts/codex-agent-team.mjs" collaborate context
```

The context identifies the current member, its Team, teammates, and `team.sharedDirectory`. Write durable shared documents there with normal file tools. When a teammate needs one, send its absolute path, why it matters, and the expected action instead of copying the document into the message.

For an incoming teammate message, do the requested work within the current member's responsibility. If the sender asks for a result, decision, or blocker, use the same `send` command to reply when there is something useful to report.
