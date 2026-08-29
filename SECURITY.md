# Security policy

## Supported status

CodexAgentTeam is an experimental macOS preview. Security fixes are applied to the latest commit on `main` until versioned releases begin.

## Reporting

Do not open a public issue for a vulnerability that could expose local files, Codex conversations, credentials, Git remotes, or remote-debugging access. Use [GitHub private vulnerability reporting](https://github.com/zyfn/codex-agent-team/security/advisories/new).

Include the Codex Desktop version, macOS version, reproduction steps, and whether a CodexAgentTeam run was active. Remove credentials, private prompts, repository contents, and sensitive local paths.

## Trust model

- Each run starts one official bundled `codex app-server` that CodexAgentTeam owns for that run. It listens on a dynamically allocated `127.0.0.1` WebSocket endpoint.
- The separate Codex Desktop exposes a dynamically allocated loopback CDP endpoint. CDP can control that renderer and must be treated as privileged local access.
- CodexAgentTeam creates no custom App Server, network relay, message queue, MCP server, or Unix control socket.
- The Team Desktop uses a separate Electron profile while sharing Codex-owned conversation storage. The ordinary Codex process and its stdio or daemon connections are not managed by CodexAgentTeam.
- Team metadata, avatars, directories, and bounded runtime diagnostics are stored under `~/.codex-agent-team/` with user-only permissions where supported.
- A local Git source is never used as a member cwd. CodexAgentTeam creates a new worktree under the Team Directory. A remote Git source is cloned there instead.
- Do not place credentials in remote Git URLs. Git authentication remains the user's responsibility and may be surfaced by Git itself.
- Avatar input is size- and signature-checked, copied under the CodexAgentTeam data root, and never rendered from an arbitrary external path.
- Member work uses Codex's native approval behavior. CodexAgentTeam does not auto-approve tools or file access.

Loopback ports reduce accidental network exposure; they are not an authentication boundary against another process running as the same macOS user. Do not run untrusted local software while CodexAgentTeam is active.

## Process and data ownership

CodexAgentTeam stops only the Runtime, App Server, Team Desktop helpers, and CDP connection created by the current run. It does not stop a user's shared daemon or ordinary Desktop stdio App Server, and it does not set global launch environment variables or install a startup job.

Using **Command-Q** in the Team Desktop ends the one-shot Runtime and its owned App Server. Team registration, Member Directories, avatars, and native Codex conversations remain on disk. Uninstalling the plugin does not delete retained data; remove `~/.codex-agent-team/` manually only after confirming it is no longer needed.
