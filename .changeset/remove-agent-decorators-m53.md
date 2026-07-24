---
"@theokit/agents": major
"@theokit/http": major
---

**Agent decorators removed — authoring is now capability composition (M53).**

BREAKING for `@theokit/agents`: every **agent** decorator is gone. The `@theokit/http` **controller**
decorators (`@Controller`/`@Get`/`@Post`/`@UseGuards`) are untouched.

- **Removed:** `@Agent`, `@MainLoop`, `@Tool`, `@Toolbox`, `@HumanInTheLoop`, `@Skills`, `@Memory`,
  `@ContextWindow`, `@ProjectContext`, `@MCP`, `@Guardrails`, `@Checkpoint`, `@SubAgents`,
  `@Compaction`, `@Gateway`, `@Trace`, `@Audit`, `@RequiresApproval`, `@Mixin` — plus nine that
  wrote metadata **no production code read** (`@Artifact`, `@Hook`, `@Observable`, `@Sandbox`,
  `@EditFormat`, `@Model`, `@RequiresCapability`, `@Policy`, `@Budget`). `@Model` never set the
  model and `@Sandbox` never sandboxed anything; deleting them removes no behavior.
- **Replacement:** `applyCapabilities([...])` composing `ModelCapability`, `AgentConfigCapability`,
  `MainLoopCapability`, `ToolboxCapability`, `skills()`, `memory()`, `mcpServers()`, `guardrails()`,
  `checkpoint()` and friends. Conflicting declarations now fail with a typed
  `CapabilityConflictError` instead of last-write-wins, and `provenance` records which capability
  contributed each field.
- **Also removed:** `bridge/walk-agent-metadata.ts` (the metadata walk) and `compileAgent`. The
  `reflect-metadata` **required peer dependency** and `experimentalDecorators`/
  `emitDecoratorMetadata` are gone from `packages/agents` — consumers of the agent surface can drop
  all three.
- **BREAKING for `@theokit/http`:** `TheoApp.create({ agents })` and `agentsPlugin({ agents })` take
  prepared entries (`{ name, route, compiled }`) instead of decorated classes; `delegate()` and
  `AgentRunner` take a spec instead of a class (`AgentRunner.builder(Class)` →
  `AgentRunner.fromSpec(spec)`).

Migration guide with the full decorator→capability map: [`MIGRATION.md`](./MIGRATION.md).

Two real defects were found and fixed while doing this: every HTTP-served agent was silently running
the **fallback model** (`@Agent({ model })` and `llmModel` were both dropped because `walk` was
passed where `compiled` was expected, through an untyped dynamic import), and the agents branch of
`TheoApp` had **no test at all** — `@theokit/agents` was never declared in `packages/http`'s
`package.json`, so nothing could link it.
