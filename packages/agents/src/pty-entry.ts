// M58 — `@theokit/agents/pty`: pass-through of `@theokit/sdk-pty`'s already-OO `PtyInteractiveBackend`
// (the PTY implementation of the `InteractiveBackend` contract). Re-export, never a wrapper
// (parsimony-ladder Rung 9). This is the one M58 domain that pulls a SEPARATE package, so `@theokit/
// sdk-pty` is declared a dependency of `@theokit/agents` — the consumer no longer depends on it directly.
export * from '@theokit/sdk-pty'
