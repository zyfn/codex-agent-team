---
name: setup
description: Open, inspect, diagnose, recover, or close Codex Agent Team. Use only when the user explicitly asks to operate the Team experience.
---

# Operate Codex Agent Team

Match the user's request to one bundled operation:

- With no additional instruction, or when asked to open Team mode, run `scripts/team.mjs open`. This performs preflight only. If it reports that confirmation is required, summarize the result and explicitly ask the user whether to switch and restart Codex. Do not start the switch in that turn.
- When the user explicitly confirms a previously prepared Team-mode switch, run `scripts/team.mjs open --confirm`.
- When asked for status, run `scripts/team.mjs status`.
- When asked to diagnose why Team mode cannot start or work, run `scripts/team.mjs diagnose`.
- When asked to continue a member in the TUI, run `scripts/team.mjs cli --team "<team>" --member "<member>"` and give the returned command to the user. Do not invent a Thread id.
- When asked to exit Team mode, run `scripts/team.mjs close`. This performs preflight only. If it reports that confirmation is required, ask the user whether to switch and restart Codex. Do not start the switch in that turn.
- When the user explicitly confirms a previously prepared return to normal mode, run `scripts/team.mjs close --confirm`.

Resolve scripts relative to this `SKILL.md`. Let the script perform its own checks. Team management happens in the right-side management panel; do not create or edit teams while merely opening Team mode.

Run only the operation the user requested. Let the script print its own checks; do not repeat each line. Switching modes is always a two-step user flow: preflight, then explicit confirmation. After confirmation, Codex receives a normal native quit request; Codex itself decides whether to show its running-session confirmation. Never bypass this confirmation, kill Codex processes, or start the opposite App Server before the current Desktop has exited naturally. Team management happens in the right-side dashboard, so opening or inspecting Team mode must never create, edit, remove, or message a Team/member.

Do not expose process identifiers, sockets, CDP ports, or internal implementation details unless the user explicitly asks for diagnostics.
