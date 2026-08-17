# Contributing

Thanks for improving Codex Agent Team.

## Before opening a change

1. Keep the product model small: a Team groups native Codex Projects and member Threads. Do not add task workflows, copied message history, or inferred completion state.
2. Preserve the boundary: Codex owns conversation history and turn execution; this project owns Team metadata, workspace setup, and the optional Desktop projection.
3. Treat the CDP adapter as version-sensitive. Changes to selectors or injected UI need a real Codex Desktop check in addition to unit tests.
4. Keep Team transport streaming and bounded. Do not add message buffers, protocol parsing, reconnect queues, or another App Server implementation.
5. Lifecycle changes must prove both directions: Team mode has no Desktop stdio child, and normal mode has no Team relay or runtime left behind.

## Local checks

```sh
npm test
npm run check
python3 /path/to/plugin-creator/scripts/validate_plugin.py plugins/codex-agent-team
```

When changing the plugin bundle, update its cachebuster and reinstall it through the configured local marketplace. Test Team mode with real Codex Desktop only after the checks pass.

## Pull requests

- Explain user-visible behavior and any changes to the Team data shape.
- Add a focused test for any changed behavior.
- Do not commit local Team metadata, runtime logs, or generated workspaces.
- State the Codex Desktop version used for manual CDP validation.
