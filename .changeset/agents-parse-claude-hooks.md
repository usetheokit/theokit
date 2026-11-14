---
'@theokit/agents': minor
---

`@theokit/agents/hooks` exports `parseClaudeHooks` and `CLAUDE_HOOK_EVENT_ALIASES` to read the Claude Code hook dialect into validated `HookSpec`s, and `buildHookHandlers` takes `projectDirEnv` to set a project-directory variable such as `CLAUDE_PROJECT_DIR` for each hook process.
