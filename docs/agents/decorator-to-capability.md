# Decorator → capability audit (M53 hard gate)

Every exported agent decorator, what it actually contributes, and the capability that replaces it.
**A decorator with no equivalent blocks the milestone** until the ADR below decides keep-or-drop.

Facts extracted from source at `@theokit/agents@0.47.0`. The pipeline being audited:

```
@Decorator → reflect-metadata → walkAgentMetadata() → AgentWalkResult → compileAgent() → CompiledAgentOptions
```

The middle two stages are what M53 deletes. What matters per decorator is therefore: **does its
contribution reach `CompiledAgentOptions`** (the waist a capability can produce), and **who else
reads it**.

## A. Waist-bound — a capability must replace it

| Decorator | Waist field(s) | Replacement capability | Semantic delta |
|---|---|---|---|
| `@Agent` | `model`, `reasoningEffort`, `parseThinkTags`, `stripToolDialect`, `recoverLeakedToolCalls`, `systemPrompt`, `maxIterations`, `timeoutMs`, `stream` | `ModelCapability` (already shipped) + `AgentConfigCapability` (new) | `@Agent` also carries `name`/`route`, which are HTTP concerns, not agent config — see § C |
| `@MainLoop` | `maxIterations`, `timeoutMs` | `MainLoopCapability` | **Shares two fields with `@Agent`**; `compileAgent:244-245` gives `@MainLoop` precedence (`mainLoop.x ?? agentConfig.x`). The capability must preserve that precedence, not `setOnce`-conflict on it |
| `@Tool` + `@Toolbox` | `tools` | `ToolsCapability` (already shipped) | `@Toolbox` supplies the namespace prefix (`toolRuntimeName`); the capability takes already-compiled tools, so the prefixing moves to the caller |
| `@HumanInTheLoop` | `hitl` | `HumanInTheLoopCapability` | keyed by `@Toolbox` namespace + `@Tool` name — the key must be constructible without the decorators |
| `@SubAgents` | `agents` | `SubAgentsCapability` | reads each child's `@Agent` config today; the capability takes child specs directly |
| `@Memory` | `memory` | `MemoryCapability` | none |
| `@Skills` | `skills` | `skills()` (already shipped) | none |
| `@ContextWindow` | `context` | `ContextWindowCapability` | none |
| `@ProjectContext` | `projectContext` | `ProjectContextCapability` | none |
| `@MCP` | `mcpServers` | `McpCapability` | none |
| `@Guardrails` | `guardrails` | `GuardrailsCapability` | none |
| `@Checkpoint` | `checkpoint` | `CheckpointCapability` | none |

Waist fields with **no** decorator source (functional authoring only, already reachable):
`settingSources`, `plugins`, `runContext`, `skillsResolver`.

## B. Not waist-bound but genuinely consumed — needs a channel, not a capability

These never reach `CompiledAgentOptions`; they feed the manifest or the loop runner. A capability
would be the wrong home for them — the capability layer produces the waist.

| Decorator | Real consumer | Decision |
|---|---|---|
| `@Gateway` | `manifest/agent-manifest.ts:76` | KEEP the data, move to the agent spec's manifest section |
| `@Compaction` | `loop/agent-runner.ts:335` | KEEP; belongs to the runner's config, not the waist |
| `@MainLoop.strategy` | `loop/agent-runner.ts:327,331` + manifest | KEEP; same as above (`maxIterations`/`timeoutMs` DO go to the waist — split the two halves) |
| `@Trace`, `@Audit` | manifest only (`:71-72`) | KEEP as per-tool metadata on the compiled tool |
| `@RequiresApproval` | manifest only (`:70`) | KEEP as per-tool metadata |
| `@Mixin` | supplies `toolboxClasses` to the walk; read by `theokit-plugin.ts:71`, `agent-endpoint.ts:64`, **`http/app.ts:297`** | Disappears with the walk — composition becomes "pass more tools" |

## C. Dead metadata — written and never read by production code

Their only readers are their own `get*` helpers, exercised solely in tests. Deleting them removes
nothing that runs.

`@Artifact` · `@Hook` · `@Observable` · `@Sandbox` · `@EditFormat` · `@Model` · `@RequiresCapability`
· `@Policy` · `@Budget` (top-level: read only to emit a `METADATA_ONLY` warning; tool-level is
hardcoded `undefined` at `walk:148`)

`@Model` deserves a callout: it is **not** how a model is set — `@Agent({ model })` is. `@Model`
writes an anonymous `theokit:custom:<n>` symbol nobody reads.

## D. Non-agent consumers (the coupling M53 must break)

| Location | What it uses | Impact |
|---|---|---|
| `packages/http/src/app.ts:281-320` | dynamic import of `walkAgentMetadata`, `compileAgent`, `generateAgentRoutes`, `getMixins`, `createSdkAgentStream` | must consume the capability path instead |
| `packages/http/src/app.ts:302` | raw `Reflect.getMetadata(Symbol.for('theokit:agents:toolbox'), Cls)` | reads `@Toolbox` **by literal symbol**, bypassing the package API — the most brittle coupling in the tree |
| `packages/agents/src/manifest/agent-manifest.ts:50-90` | consumes `AgentWalkResult` wholesale | must be re-sourced from the spec |
| `packages/agents/src/loop/agent-runner.ts:322-337` | `walkAgentMetadata` + `mainLoop.strategy` + `compaction` | must be re-sourced |
| `packages/agents/src/theokit-plugin.ts:71`, `bridge/agent-endpoint.ts:64` | `getMixins` | disappears with `@Mixin` |
| `packages/http/tests/integration/template-app-e2e.test.ts:33` | imports `../../../agents/src/decorators/index.js` | cross-package test to repoint |

## E. Scale of the repoint

- **54** of 106 test files under `packages/agents/tests/` import from `src/decorators/`.
- **61** import `reflect-metadata`.
- `reflect-metadata` is a **required peer dependency** of `packages/agents` (`peerDependencies`), not
  merely a dev dep — dropping it is a breaking change for consumers, which the major bump covers.
- `packages/agents/tsconfig.json` sets `experimentalDecorators` **and** `emitDecoratorMetadata`.

## Verdict against the DoD hard gate

No decorator lacks a resolution: every one is in A (capability), B (keep, different channel), or C
(dead — drop). The ADR recording the keep/drop decisions for B and C is
`knowledge-base/adrs/0002-decorator-removal-scope.md`.
