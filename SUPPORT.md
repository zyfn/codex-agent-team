# Support

CodexAgentTeam is currently an experimental macOS preview. Launching it verifies the bundled Codex and official App Server capabilities, then starts a separate Codex Desktop with an isolated Electron profile. Private renderer and sidebar capabilities can only be verified against that attempted Team Desktop; if the check fails, the owned runtime closes and the ordinary Codex remains untouched.

## Supported environment

- macOS
- Node.js 22 or later
- Git
- Codex Desktop installed at `/Applications/Codex.app`
- a Codex Desktop and bundled CLI combination accepted by CodexAgentTeam's built-in preflight
- Ghostty 1.3.1+ or cmux only when using the optional terminal layout

Codex Desktop evolves quickly. A successful install or preflight is not the same as a working Dashboard; compatibility is accepted only after the CodexAgentTeam Desktop reaches its visible active state.

## Compatibility promise

CodexAgentTeam does not modify Codex conversation history, SQLite databases, rollout files, `config.toml`, authentication, or Thread data formats.

Native conversation operations use the Codex App Server protocol. The global Desktop entry and avatars require a small, fail-closed Desktop adapter. If Codex changes a required capability, CodexAgentTeam reports the incompatibility instead of guessing or rewriting Codex state.

Team metadata, Member Directories, and native Threads remain preserved after an adapter failure.

## Before reporting an issue

Use `$codex-agent-team:launch` and ask it to report status or run diagnostics. Include:

- macOS version;
- Codex Desktop version;
- bundled Codex CLI version;
- the bounded diagnostic output;
- whether the failure happened during preflight, Desktop opening, Dashboard use, or shutdown.

Do not include authentication data, private prompts, source code, or complete conversation history.

## Release status

Preview releases are validated with automated tests and a real Desktop acceptance checklist. A release is marked stable only after its supported Desktop matrix has passed the full install, open, create, collaborate, terminal, shutdown, ordinary-reopen, and uninstall flow.

For security-sensitive reports, follow [SECURITY.md](./SECURITY.md).
