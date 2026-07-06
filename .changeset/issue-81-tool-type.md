---
'@theokit/agents': patch
'create-theokit': patch
---

Fix (#81): `defineAgent({ tools })` now type-accepts the `@theokit/sdk` `CustomTool` that `defineAgentTool` and every `@theokit/sdk-tools` factory return (previously `CustomTool` was not assignable to the internal `CompiledTool`, so the documented tool pattern failed `tsc` even though it ran). The `tools` field is typed `readonly CustomTool[]` and normalized to `CompiledTool` at compile.

Fix (#80): the `create-theokit` default template now type-checks, builds, AND renders on a fresh scaffold. `app/page.tsx` was migrated to the `@theokit/ui@1.0.0` auto-dispatch chat API (`ChatMessage` takes a `UIMessage` and renders its parts; the old manual `Message`/`ToolCallCard` flatten is gone), the template ships `@types/node` + `experimentalDecorators`/`emitDecoratorMetadata` (so tool handlers and the `@Agent` class surface type-check), and a jsdom render test (`app/page.test.tsx`) guards against future `@theokit/ui` drift. A pristine scaffold now passes `tsc --noEmit` with 0 errors (was 7).
