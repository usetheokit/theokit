---
'@theokit/agents': minor
---

Add `prepareWorkspace` and `detectWorkspaceRecipe` to `@theokit/agents/bridge`: a fresh checkout is prepared by one recipe (devcontainer lifecycle, a configured setup script, or a lockfile install), and a failure throws `WorkspaceRecipeError` naming the source and stage, with the original as `cause`. `worktreeProvider` gains `prepare: true`.
