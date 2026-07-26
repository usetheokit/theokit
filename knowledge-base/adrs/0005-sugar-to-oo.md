# ADR 0005 — Sugar → OO: the authoring surface is 100% classes (M57)

- **Status:** accepted
- **Date:** 2026-07-24
- **Milestone:** M57 (`knowledge-base/plans/sugar-to-oo-plan.md`)
- **Reverses:** ADR 0001 § 4 (`skills()` kept as a plain factory, "the documented counter-example")
- **Supersedes for the builders:** the free `agent()` / `contextualTool()` functions (M8)

## Context

`@theokit/agents` exposed its authoring surface as a mix of shapes: four capabilities were classes
(`ModelCapability`, `ToolsCapability`, `AgentConfigCapability`, `MainLoopCapability`), while ~14
were **free factory functions** (`memory`, `skills`, `contextWindow`, `checkpoint`, `subAgents`,
`projectContext`, `mcpServers`, `guardrails`, `humanInTheLoop`, `skillsOptions`, `settingSources`,
`plugins`, `runContext`, `skillsResolver`), plus two free builder functions (`agent()`,
`contextualTool()`). The user calls these "sugar".

Two forces made the mix indefensible now, where it was defensible at M52:

1. **The SDK finished its own migration.** `@theokit/sdk` v3.0 removed every free `define*`/`create*`
   function and standardized on `X.create()` (`Tool.create`, `Agent.create`, `Provider.create`, …).
   theokit's job is to **wire the SDK's shape into agent-builder with Codex UX/DX**, not to invent a
   second authoring idiom next to it. A `memory(x)` free function beside `Tool.create(x)` is exactly
   the kind of surface drift the layered `SDK → Theokit → AgentBuilder` boundary exists to remove.

2. **ADR 0001 § 4's premise no longer holds.** That ADR kept `skills()` as a factory as the in-repo
   proof that "a class with no behaviour would be ceremony (KISS)". At M52 that was true — `skills`
   was the lone pure-data case. It is no longer lone: the uniform 12/12 surface is now the reader's
   mental model, and one function among fifteen classes is the ceremony — the exception a reader has
   to hold in their head, not the class. KISS applies to the **surface a consumer learns**, not to
   the line count of one definition.

## Decision

Convert every remaining free factory to a class, and both free builders to a static factory:

| Was (free function) | Now (OO) |
|---|---|
| `memory(x)`, `projectContext(x)`, `mcpServers(x)`, `guardrails(x)`, `humanInTheLoop(x)`, `settingSources(x)`, `plugins(x)`, `runContext(x)`, `skillsResolver(x)` | `new MemoryCapability(x)`, … (9 one-line subclasses of a shared `FieldCapability` base) |
| `skills(x)`, `contextWindow(x)`, `checkpoint(x)`, `subAgents(x)`, `skillsOptions(x)` | `new SkillsCapability(x)`, … (behaviour-carrying classes) |
| `agent()` | `AgentBuilder.create()` |
| `contextualTool(x)` | `ContextualTool.of(x)` |

Design choices inside the decision:

- **`FieldCapability<K>` base for the pure-assignment ones.** Nine of them do nothing but `setOnce`
  one waist field. A shared abstract base keeps them one line each (`readonly name` + `protected
  readonly field`) — DRY without ceremony. This is **not** the Template-Method ADR 0001 refused:
  that was inheritance of variable *behaviour* (`shouldContinue`); here the base carries *data*
  (name/field) and `apply` is identical for all, so no subclass can diverge.
- **Behaviour moves with the feature.** `SkillsCapability` keeps the boundary validation (now in the
  constructor — fail-fast at authoring, the same place `ModelCapability` validates) and the
  delegate-to-`compileSkillsSelection` + concat-merge in `apply`. `CheckpointCapability` keeps the
  storage-metadata warning; `SubAgentsCapability` the typed duplicate-child conflict;
  `ContextWindowCapability`/`SkillsOptionsCapability` the delegation to the canonical compilers.
- **`AgentBuilder` / `ContextualTool` are a TYPE and a VALUE at once.** The generic interface stays
  in type space; a same-named `const` holds the static factory in value space. No collision (the
  SDK uses the same dual-space pattern for `Agent`/`Tool`), no `namespace`, and the fluent
  type-state chain is untouched — `.create()` delegates to the internal `makeBuilder`.
- **`.of()` not `.create()` for `ContextualTool`.** It has no instance state — it tags an existing
  tool with a type-level witness. `of` reads as a pure adaptor; `create` would imply construction.

## Zero-behavior guarantee (the oracle)

The conversion is **repointing, not rewriting**. The gate is the same one M52/M53 used: the existing
deterministic suite (608 tests) and the type suite (104) pass **without editing a single
expectation** after the call-sites move from `x(a)` to `new XCapability(a)` /
`AgentBuilder.create()`. The equivalence tests in `agent-capabilities.test.ts` /
`capability-zero-behavior.test.ts` assert `new X(a).apply(draft)` lands the same waist field the old
function did; the builder runtime + type tests prove `AgentBuilder.create()…build()` is identical to
`agent()…build()`. `tsc --noEmit` (package + root, the latter covering `tests/**`) is clean.

## Consequences

- **BREAKING (major).** A consumer importing the free functions from `@theokit/agents` breaks:
  `memory(x)` → `new MemoryCapability(x)`, `skills(x)` → `new SkillsCapability(x)`, `agent()` →
  `AgentBuilder.create()`, `contextualTool(x)` → `ContextualTool.of(x)`, etc. Mechanical, 1:1, no
  behaviour change. Recorded in the CHANGELOG migration note and shipped as a `major` changeset.
- **Surface is now uniform.** 16/16 capabilities are classes; both builders are `X.create()`/`X.of()`.
  A reader learns one idiom, the SDK's.
- **`FieldCapability` base is public** (via `export *`). It is a legitimate extension point (a
  consumer can add a pure-assignment capability by subclassing) and harmless — but it is the one new
  symbol on the surface; noted here so a future audit does not read it as an accidental leak.

## Why this is not a KISS/YAGNI violation

The nine one-line subclasses add ~3 lines each over the old factory calls. That cost buys a **single
learnable surface** aligned with the runtime the layer exists to wrap. Per `parsimony-ladder.md`, the
ladder eliminates *unnecessary complexity* — an idiom split that forces every reader to remember
"most are classes, these fifteen… fourteen are functions" is the unnecessary complexity here, and the
uniform class surface removes it. The behaviour-carrying classes are not new code — they are the
exact function bodies, relocated.
