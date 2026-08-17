---
name: communicate
description: Help a Codex Agent Team member communicate with another member through the target member's native persistent conversation. Use when the user or current work explicitly requires information, a decision, assistance, or delivery from a named teammate.
---

# Communicate with a teammate

Identify one target teammate and compose one concise, actionable message containing the goal, necessary context, expected result, and important constraints.

If the target or request is unclear, ask one concise question. Otherwise run:

```bash
node ../setup/scripts/send-member-message.mjs --target "<member name>" --message "<message>" --cwd "$PWD"
```

Resolve the command relative to this `SKILL.md`. The script resolves the current member and target inside the same Team, then sends one message to the target's native conversation.

After Codex accepts the message, briefly tell the user who was contacted and what was requested. Do not treat acceptance as business completion, broadcast, automatically forward replies, or create a reply loop.
