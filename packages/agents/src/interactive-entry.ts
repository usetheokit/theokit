// M58 — `@theokit/agents/interactive`: pass-through of the SDK's already-OO interactive surface
// (`InteractiveBackend` contract + `StartInteractiveOptions` / `StartInteractiveResult`). Re-export,
// never a wrapper (parsimony-ladder Rung 9): the backend interface is already the seam to depend on.
export * from '@theokit/sdk/interactive'
