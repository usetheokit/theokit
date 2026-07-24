# ADR 0002 — What happens to each agent decorator when the surface is deleted (M53)

- **Status:** accepted
- **Date:** 2026-07-23
- **Milestone:** M53
- **Depends on:** [ADR 0001](0001-capability-patterns-budget.md) (the capability layer), the audit at
  `docs/agents/decorator-to-capability.md`

## Context

M53's DoD makes this a **hard gate**: *"a decorator with NO capability equivalent BLOCKS the
milestone — an ADR decides keep-or-drop before code proceeds."* The audit found that the 28 exported
decorators are not one homogeneous group; they fall into three, and only one of them wants a
capability.

Deleting the metadata walk is what forces the decision: `walkAgentMetadata` is read not only by
`compileAgent` but by the manifest generator, the loop runner, and `@theokit/http`'s app builder.

## Decision

### Group A — waist-bound (12 decorators) → become capabilities

`@Agent`, `@MainLoop` (its `maxIterations`/`timeoutMs` half), `@Tool`+`@Toolbox`,
`@HumanInTheLoop`, `@SubAgents`, `@Memory`, `@Skills`, `@ContextWindow`, `@ProjectContext`, `@MCP`,
`@Guardrails`, `@Checkpoint`.

Each gets exactly one capability producing exactly the field(s) `compileAgent` produces today, and
each is pinned by removing its name from `NOT_EXPRESSIBLE_YET` in the zero-behavior test — which
fails the moment the claim and the code disagree, in either direction.

**One precedence trap, recorded so it is not lost:** `maxIterations` and `timeoutMs` are written by
BOTH `@Agent` and `@MainLoop`, and `compileAgent:244-245` resolves them as
`mainLoop.x ?? agentConfig.x` — MainLoop wins. A naive `setOnce` would raise a conflict where today
there is a defined winner. `MainLoopCapability` must preserve the precedence explicitly.

### Group B — real consumers outside the waist → keep the capability, change the channel

These never reach `CompiledAgentOptions`, so a capability is the wrong home (the capability layer's
whole contract is that it produces the waist). Each keeps its behavior through a channel that
already exists or is a one-line extension of one:

| Decorator | Channel it moves to | Why this is not invention |
|---|---|---|
| `@Compaction` | `AgentRunner` builder override | **Already exists** — `agent-runner.ts:334` documents "builder override WINS over the `@Compaction` decorator"; the decorator is only the fallback. Deleting it leaves the primary channel intact |
| `@MainLoop.strategy` | `AgentRunner` builder override | Mirrors `reflectionOverride`, which is already there (`agent-runner.ts:328-331`) |
| `@Gateway` | explicit field on the authoring surface, read by the manifest generator | Its only consumer is `manifest/agent-manifest.ts:76` — it is manifest data, not agent config |
| `@Trace`, `@Audit`, `@RequiresApproval` | per-tool metadata on the compiled tool | Their only consumer is the manifest (`:70-72`), and they are already per-tool in the walk |
| `@Mixin` | pass the extra tools directly | Composition by metadata exists only because decorators cannot compose values; capabilities compose by construction |

### Group C — dead metadata (9 decorators) → DROP, no replacement

`@Artifact`, `@Hook`, `@Observable`, `@Sandbox`, `@EditFormat`, `@Model`, `@RequiresCapability`,
`@Policy`, `@Budget`.

Each writes reflect-metadata that **no production code reads** — their only readers are their own
`get*` helpers, exercised solely in tests. Deleting them removes nothing that runs. Two are worth
calling out because their names imply otherwise:

- **`@Model` does not set the model.** `@Agent({ model })` does. `@Model` writes an anonymous
  `theokit:custom:<n>` symbol nobody reads. Keeping it would preserve a trap, not a feature.
- **`@Sandbox` does not sandbox anything.** Its metadata is unread; the exported
  `isPathAllowed`/`isCommandAllowed` helpers have no production caller. A real sandbox is
  `@theokit/sdk`'s, reached through `Agent.create`.

Dropping a decorator whose metadata is never read is not a behavior change — it is the removal of a
misleading affordance. Their tests are deleted with them (a test for dead metadata asserts nothing
about the product).

## Consequences

- **`@theokit/http` must stop reading agent metadata.** `app.ts:302` reads `@Toolbox` via a raw
  `Reflect.getMetadata(Symbol.for('theokit:agents:toolbox'), Cls)` — a literal symbol string that
  bypasses the package's API entirely. This is the most brittle coupling in the tree and it breaks
  the moment the decorators go. The **controller** decorators (`@Controller`/`@Get`/`@Post`) are
  explicitly out of scope and keep their own decorator config.
- **`reflect-metadata` is a required peer**, not a dev dependency. Dropping it is a breaking change
  for consumers — which is what the major bump announces.
- **The manifest generator and the loop runner must be re-sourced** from the spec instead of the
  walk. They are the two consumers that make this a migration rather than a deletion.
- **54 of 106 test files** import decorators. Per the DoD, they are repointed with **no expectation
  edited** — except Group C's tests, which are deleted along with the dead code they cover. That
  exception is stated here so it cannot later be mistaken for a weakened assertion.

## Alternatives considered

- **Keep Group B as decorators.** Rejected: it leaves `reflect-metadata`, `experimentalDecorators`
  and the metadata walk alive for six decorators that feed a manifest — every cost preserved for a
  fraction of the surface, which is the "sugar layer" the owner already refused for M53.
- **Give Group B capabilities that write outside the waist.** Rejected: it breaks the capability
  contract (a capability produces `CompiledAgentOptions`), turning a narrow waist back into a grab
  bag. Their data is not agent-creation config and should not travel as if it were.
- **Delete Group B outright.** Rejected: unlike Group C, these have real consumers today. Deleting
  them would remove working behavior, which no part of this initiative authorizes.
