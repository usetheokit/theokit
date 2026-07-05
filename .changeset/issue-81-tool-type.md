---
'@theokit/agents': patch
'create-theokit': patch
---

Fix (#81): `defineAgent({ tools })` now type-accepts the `@theokit/sdk` `CustomTool` that `defineAgentTool` and every `@theokit/sdk-tools` factory return (previously `CustomTool` was not assignable to the internal `CompiledTool`, so the documented tool pattern failed `tsc` even though it ran). The `tools` field is typed `readonly CustomTool[]` and normalized to `CompiledTool` at compile.

Fix (#80 partial): the `create-theokit` default template now ships `@types/node` and enables `experimentalDecorators`/`emitDecoratorMetadata`, so agent tool handlers (which use `process`/`node:fs`) and the `@Agent`/`@Tool` class surface type-check on a fresh scaffold.
