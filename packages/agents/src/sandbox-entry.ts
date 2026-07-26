// M58 — `@theokit/agents/sandbox`: pass-through of the SDK's already-OO sandbox surface
// (`LocalSandbox` class + `SandboxBackend` contract + `SandboxConfig`). The consumer imports its
// sandbox primitives from the Theokit layer, not from `@theokit/sdk/sandbox` directly. Re-export,
// never a wrapper (parsimony-ladder Rung 9): `SandboxBackend` is already the interface to depend on.
export * from '@theokit/sdk/sandbox'
