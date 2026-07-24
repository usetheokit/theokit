# Migration guide

## `@theokit/agents` v1.0 — agent decorators removed (M53)

**Breaking.** The **agent** decorators were removed. Authoring an agent is now composing
**capabilities** — values you pass, not metadata a class carries.

The `@theokit/http` **controller** decorators (`@Controller`, `@Get`, `@Post`, `@UseGuards`, …) are
**untouched**. This migration is only about the agent surface.

### Why

The decorator surface cost `reflect-metadata` (a **required** peer dependency),
`experimentalDecorators` + `emitDecoratorMetadata` in every consumer's tsconfig, and a metadata walk
that had to be kept in sync with the compiler. What it bought — declaring an agent's config next to
its class — capabilities give without any of that, plus three things decorators could not:

| | decorator | capability |
|---|---|---|
| Build config | needs `reflect-metadata` + `experimentalDecorators` | none |
| Conflicting declarations | silent — last write wins | **typed error** (`CapabilityConflictError`) |
| Who set what | opaque metadata | `draft.provenance` says which capability contributed each field |
| Authoring from a config **file** | impossible (needs a class) | `CapabilityRegistry` resolves name → capability |

### The 30-second version

```diff
- @Agent({ model: 'openai/gpt-5.4', systemPrompt: 'You are helpful.' })
- @Skills(['code-review'])
- export class SupportAgent {
-   @MainLoop({ strategy: 'react', maxIterations: 5 })
-   async run() {}
- }
+ export const supportAgent = applyCapabilities([
+   new ModelCapability('openai/gpt-5.4'),
+   new AgentConfigCapability({ systemPrompt: 'You are helpful.', maxIterations: 5 }),
+   skills(['code-review']),
+ ])
```

Then run it with `AgentRunner.fromSpec({ name: 'support', compiled: supportAgent, strategy: 'react' })`.

---

## Decorator → capability map

Every removed decorator, and what replaces it. Import everything from `@theokit/agents`.

### Group A — replaced by a capability

| Removed decorator | Replacement | Notes |
|---|---|---|
| `@Agent({ model })` | `new ModelCapability(id, reasoningEffort?)` | `name`/`route` are HTTP concerns — see § Mounting |
| `@Agent({ systemPrompt, parseThinkTags, stripToolDialect, recoverLeakedToolCalls, stream, maxIterations, timeoutMs })` | `new AgentConfigCapability({ … })` | same field names |
| `@MainLoop({ maxIterations, timeoutMs })` | `new MainLoopCapability({ … })` | **wins** over `AgentConfigCapability`, as before |
| `@MainLoop({ strategy })` | `AgentRunner.fromSpec({ strategy })` | strategy is a runner concern, not a compiled field |
| `@Tool` + `@Toolbox` | `new ToolboxCapability(instance, { namespace })` | see § Toolboxes |
| `@HumanInTheLoop` | `hitl` on the tool declaration | see § Toolboxes |
| `@Skills([...])` | `skills([...])` | accepts `string \| InlineSkill` |
| `@Skills({ include, autoDiscover })` | `skillsOptions({ include, autoDiscover })` | the options form |
| `@Memory({...})` | `memory({...})` | |
| `@ContextWindow({...})` | `contextWindow({...})` | |
| `@ProjectContext({...})` | `projectContext({...})` | |
| `@MCP({...})` | `mcpServers({...})` | |
| `@Guardrails([...])` | `guardrails([...])` | |
| `@Checkpoint({...})` | `checkpoint({...})` | keeps the "non-filesystem storage does not resume" warning |
| `@SubAgents([...])` | `subAgents({ name: spec })` | takes child specs directly |

### Group B — moved to a different channel (not a capability)

These never reached the compiled agent options, so a capability would be the wrong home.

| Removed decorator | Where it went |
|---|---|
| `@Compaction(name, opts)` | `AgentRunner.fromSpec({ compaction: { name, keepTokens } })` or `.compaction(name, opts)` — the builder override already outranked the decorator |
| `@MainLoop({ strategy })` | `AgentRunner.fromSpec({ strategy })` (see Group A) |
| `@Gateway({...})` | declare it on the manifest entry — it only ever fed `generateAgentManifest` |
| `@Trace` / `@Audit` | `trace: true` / `audit: true` on the tool declaration (manifest-only flags) |
| `@RequiresApproval` | `approval` on the tool declaration |
| `@Mixin(Toolbox)` | pass another `ToolboxCapability` — composition replaces metadata-based mixing |

### Group C — REMOVED with no replacement (they did nothing)

Each of these wrote metadata **no production code ever read**. Deleting them removes no behavior.
If you used one, deleting the line is the whole migration.

`@Artifact` · `@Hook` · `@Observable` · `@Sandbox` · `@EditFormat` · `@Model` ·
`@RequiresCapability` · `@Policy` · `@Budget`

Two deserve a callout, because the name implied otherwise:

- **`@Model` did not set the model.** `@Agent({ model })` did. `@Model` wrote an anonymous symbol
  nobody read. Use `ModelCapability`.
- **`@Sandbox` did not sandbox anything.** Its metadata was unread and its exported
  `isPathAllowed`/`isCommandAllowed` helpers had no production caller. A real sandbox is
  `@theokit/sdk`'s, reached through `Agent.create`.
- **`@Budget` only emitted a warning saying it had no effect.** The warning went with it.

---

## Toolboxes

A toolbox class now declares its tools as **data** and keeps handlers as ordinary methods — so it
can still hold state and receive injected dependencies:

```diff
- @Toolbox({ namespace: 'ops' })
- class OpsTools {
-   @Tool({ name: 'deploy', description: 'Deploy', input: z.object({ env: z.string() }) })
-   @HumanInTheLoop({ question: 'Confirm deploy?' })
-   async deploy({ env }: { env: string }) { return doDeploy(env) }
- }
+ class OpsTools {
+   static readonly tools: ToolDeclaration[] = [
+     {
+       name: 'deploy',
+       description: 'Deploy',
+       input: z.object({ env: z.string() }),
+       method: 'deploy',
+       hitl: { question: 'Confirm deploy?' },
+     },
+   ]
+   constructor(private readonly k8s: K8sClient) {}
+   async deploy({ env }: { env: string }): Promise<string> { return this.k8s.deploy(env) }
+ }
```

Compose it with `new ToolboxCapability(new OpsTools(k8s), { namespace: 'ops' })`. The tool is still
named `ops.deploy`, the handler is still bound to the instance, and the `hitl` gate still lands in
the same `compiled.hitl` map.

**One improvement:** a typo in `method` now fails at **authoring** time (`ConfigurationError`),
instead of when the model finally decides to call the tool.

## Mounting (name / route)

`@Agent({ name, route })` carried two HTTP concerns that are not agent configuration. They now go on
the mount entry:

```diff
- @Agent({ name: 'support', route: '/api/agents/support', model: 'openai/gpt-5.4' })
  const app = await TheoApp.create({
    controllers: [...],
-   agents: [SupportAgent],
+   agents: [{ name: 'support', route: '/api/agents/support', compiled: supportAgent }],
  })
```

`agentsPlugin({ agents })` takes the same entry shape.

## Authoring from a config file (new)

Not a migration — a capability the decorators could not offer. A registry resolves names to
capabilities, so an agent can be declared in `.theokit/agent.json` instead of in code:

```typescript
const registry = new CapabilityRegistry()
  .register('model', (id) => new ModelCapability(id as string))
  .register('skills', (names) => skills(names as string[]))

const compiled = applyCapabilities(
  config.capabilities.map((c) => registry.resolve(c.name, c.arg)),
)
```

Wrong-typed values from the file fail at the boundary with a typed `ConfigurationError` — the
message names the offending **type**, never its content (a config file may carry tokens).

## Build config you can now delete

```diff
  // tsconfig.json
  "compilerOptions": {
-   "experimentalDecorators": true,
-   "emitDecoratorMetadata": true,
  }
```

```diff
  // package.json
  "dependencies": {
-   "reflect-metadata": "^0.2.0",
  }
```

```diff
  // your entry file
- import 'reflect-metadata'
```

> Keep all three **if** you also use the `@theokit/http` controller decorators — those still need
> them. This removal applies to the agent surface only.

## Codemod

There is **no automated codemod**, and that is deliberate rather than an omission: the mechanical
half (rename `@X` → `x()`) is the easy part, while the two decisions that actually matter cannot be
inferred from the source —

1. **Where the toolbox's dependencies come from.** The decorator form had no constructor injection,
   so a codemod has no way to know what `new OpsTools(???)` should receive.
2. **Which decorators were Group C.** Those lines are deleted, not translated — a codemod that
   "migrated" them would invent a capability for something that never did anything.

The map above is ordered so you can work top-down through a file. If your codebase is large enough
that a project-specific codemod pays for itself, the Group A table is a direct rename table; Groups
B and C need a human.
