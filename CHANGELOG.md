# Changelog

## Unreleased

- Organize native Codex Projects and conversations as persistent Teams and Members.
- Add a global CodexAgentTeam Dashboard with native conversation navigation and runtime status.
- Create each Member in an empty Team-owned directory, a local Git worktree, or a remote Git clone.
- Support responsibilities, built-in or custom avatars, and initial Codex model settings.
- Make Team collaboration automatically discoverable and route messages directly to selected native member Threads.
- Open the same native member conversations in optional Ghostty or cmux split layouts.
- Run in a separate Codex Desktop with an isolated profile and one temporary official Codex App Server.
- Preserve native conversations, Team data, Member Directories, worktrees, branches, and avatars when a run ends or a member is removed.
- Fail closed when required experimental Codex Desktop capabilities are unavailable.
- Use the shorter **AgentTeam** label for the in-app projection, detect installed terminal applications once per Runtime, show their native macOS icons, and open them from one Team-header menu through native AppleScript automation.
- Keep member initialization and successful message confirmations concise without exposing internal routing terminology.
- Clarify member creation with one working-files choice at a time and a labeled destination preview.
- Resolve member identity only from native Thread identity or native cwd, and lazily resume only the message target.
- Validate the Runtime process command before trusting or signaling a persisted PID.
- Coalesce App Server event bursts into serialized Dashboard refreshes.
- Use a compact full-width Team monitor with lazy member rendering while preserving independent and all-Team expansion.
- Label model choices as initial settings and reject silent provider fallback for an explicitly selected model.
