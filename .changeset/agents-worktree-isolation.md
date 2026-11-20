---
'@theokit/agents': minor
---

Add `worktreeProvider` and an `isolation` option on `delegate` / `SubAgentSpec`: each delegated task runs in its own git worktree on its own branch, released afterwards, with the gitignored files listed in `.worktreeinclude` (such as `.env`) copied in. Also exports `WorkspaceProviderError`.
