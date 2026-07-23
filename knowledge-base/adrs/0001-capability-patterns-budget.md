# ADR 0001 — Patterns budget for capability-based agent authoring (M52)

- **Status:** accepted
- **Date:** 2026-07-23
- **Milestone:** M52 (`knowledge-base/plans/capability-core-plan.md`)
- **Supersedes:** the decorator/metadata authoring pipeline (removed in M53)

## Context

The user asked for the **maximum number of design patterns** in the new `@theokit/agents`
authoring layer. That request is in direct tension with the project's own unbreakable rules —
KISS (§10), YAGNI (§11) and "a pattern where a direct solution works is an anti-pattern".
Resolving that tension by silently picking a middle ground would be dishonest, so the budget is
recorded explicitly: **a pattern is adopted only when a real variation (or a rule) demands it,
and every refusal is named.** "Maximum" here means the maximum *defensible* set, not the maximum
countable set.

The second force is zero-behavior: M53 deletes the decorator source. That deletion is only safe
if the new path provably lands on the SAME representation the old one produced.

## Decision

### 1. Reuse the existing narrow waist — do not invent a third representation

The design spike proposed a new `AgentSpec` + `SdkAgentAdapter`. Discovery showed both already
exist: `CompiledAgentOptions` (`bridge/agent-compiler.ts`) is the waist, and
`assembleM8CreateOptions` (`bridge/sdk-adapter-create-options.ts`) is the adapter. Capabilities
therefore produce a `CompiledAgentOptionsDraft` — the *same* waist — instead of a parallel one.
Inventing `AgentSpec` would have created a third representation to keep in sync (the exact
duplication this milestone exists to remove).

### 2. Adopted patterns (13) — each earns its place by a named variation

| Pattern | Where | The variation that justifies it |
|---|---|---|
| Strategy | `Capability.apply` | N independent ways to enrich an agent; a central `switch` would violate OCP |
| Decorator (value-level) | capabilities compose over one draft | enrichment stacks without subclassing |
| Composite | `CapabilityPreset` | a preset must be usable *as* one capability |
| Registry | `CapabilityRegistry` | file-based authoring resolves NAME → capability without a growing switch |
| Factory Method | registry factories | argument shape varies per capability |
| Builder | draft accumulation via `applyCapabilities` | ordered, deterministic accumulation |
| Facade | `applyCapabilities(caps)` | one call hides draft creation + ordering |
| Adapter | `assembleM8CreateOptions` (reused) | framework language → runtime language |
| Specification | `ModelCapability` validation | validity is a first-class, testable rule |
| Chain of Responsibility | tool interceptors (existing hooks shape) | independent interceptors may veto/transform |
| State | draft mutation across the apply sequence | the draft *is* accumulating state |
| Memento | `provenance[]` | who contributed what — replaces the metadata opacity `@Expose` patched |
| Null Object | `createDraft()` empty draft | no `undefined` branch at the start of the fold |

### 3. Refused patterns (8) — refusal is a decision, not an omission

| Refused | Why |
|---|---|
| Singleton | a module-exported registry value is testable and substitutable; `getInstance()` is not (DIP) |
| Visitor | the draft is a stable record — double dispatch buys nothing (KISS) |
| Abstract Factory | one product family (`Capability`); indirection without variation (YAGNI) |
| Mediator | capabilities never talk to each other — the draft already IS the meeting point |
| Template Method | no fixed-step algorithm hierarchy; Strategy covers it (OCP over inheritance) |
| Observer | streaming is already an async iterator; a second mechanism would duplicate it |
| Flyweight / Prototype / Interpreter | no shared-instance pressure, no cloning need, no grammar |

### 4. `skills()` is a plain factory, NOT a class — the documented counter-example

It carries no state; a class would be ceremony. It is kept deliberately as the in-repo proof that
"maximum patterns" is bounded by KISS, and it **delegates to `compileSkillsSelection`** rather than
reimplementing the settings shape. It does validate its argument — validation is a boundary duty
(the registry hands it `unknown` straight from a config file), not a reason to promote it to a
class.

## Consequences

- **Positive.** One waist, one adapter, three authoring routes (fluent, preset, file) that provably
  converge. Conflicts fail fast and typed (`CapabilityConflictError`) where decorators silently
  let the last write win. Provenance makes composition auditable. No `reflect-metadata`, no
  `experimentalDecorators` in the new path.
- **Negative.** Thirteen named patterns is more vocabulary than a plain options object would need;
  a reader must learn `Capability` before contributing one. Mitigated by the contract being two
  members (`name`, `apply`).
- **Proof obligation (partially met — scope corrected after adversarial review).**
  `tests/unit/capability-zero-behavior.test.ts` asserts the capability path deep-equals BOTH
  `compileAgentDefinition` (the `defineAgent` source) AND `compileAgent` (the DECORATOR compiler —
  the artifact M53 deletes) on every field the layer can express, including via the registry/file
  route, and is confirmed end-to-end against a real provider
  (`tests/live/live-m52-capability.test.ts`). It does **not** authorize the deletion on its own: see
  the entry criterion below.
- **Equivalence is DEEP-EQUAL, not textual.** Top-level key order and undefined-valued keys differ
  between the paths and are not part of the contract — nothing in the package serializes or hashes
  compiled options (`Object.keys` appears only over nested values,
  `sdk-adapter-create-options.ts:76,91`). An earlier draft of this ADR said "byte-identical"; that
  was a stronger claim than the evidence supports and has been corrected.

## M53 entry criterion (from the adversarial review)

The capability layer currently expresses **5** of the waist's fields (`model`, `reasoningEffort`,
`tools`, `skills`/`skillsResolver`, `stream`). Ten fields remain producible only by the decorator
compiler: `systemPrompt`, `hitl`, `checkpoint`, `context`, `projectContext`, `mcpServers`,
`guardrails`, `memory`, `maxIterations`, `timeoutMs`. Deleting `src/decorators/` before each has a
capability (or an ADR dropping it) would REMOVE authoring surface with no replacement. That gap is
pinned as an executable assertion in the zero-behavior test, so it cannot silently drift — the test
fails the moment the list and the code disagree.

### What the gates caught (audit trail — none of this was found by reading the code)

The first run of the zero-behavior test FAILED: the hand-written `skills` capability emitted
`{ enabled }` while the canonical compiler emits `{ enabled, autoInject: true }`. The fix was to
delegate to `compileSkillsSelection` (Don't-Reinvent, §9), and three earlier unit expectations
that had encoded the wrong shape were corrected. Without the zero-behavior gate, that divergence
would have shipped silently and surfaced as behavior drift after M53's deletion.

An adversarial review (agent instructed to REFUTE, not confirm) then found four more defects in
the first cut, each now fixed with a regression test in `capability.test.ts § Adversarial-review
regressions`:

| # | Defect | Fix |
|---|---|---|
| V1 | The proof compared only against `compileAgentDefinition` — a sibling of the deletion target, not the target. | Proof extended to `compileAgent`; the uncovered-field gap pinned as an executable assertion. |
| V3 | `setOnce` compared with `!==` (reference identity), so declaring the SAME logical value twice threw a phantom conflict, and the pre-seeded `stream` made `stream: false` unreachable. | Deep equality; `stream` defaulted at finalize instead of seeded. |
| V4 | `skills` used `setOnce` where the reference compiler has merge semantics — a preset's baseline skills could never be extended at the call site, defeating the Composite. | `skills` accumulates. |
| V5 | The registry had zero boundary validation: `skills: "code-review"` from a config file spread into eleven single-character skill names, silently. | Typed `ConfigurationError` at the boundary; the message names the offending TYPE, never the value (config files can hold secrets). |
| V6 | `src/capability/index.ts` was exported from nowhere — the whole layer was unreachable by consumers (wiring pillar (a) missing). | Exported from `src/index.ts`. |

A SECOND adversarial review then attacked the fixes themselves and broke four of six vectors —
proof that one review pass is not enough when the fixes are non-trivial:

| # | Defect the FIXES introduced | Fix |
|---|---|---|
| R2 | The review claimed the accumulate fix "manufactured" a duplicate by concatenating. **REVERTED — the review was wrong and I accepted it without checking.** See § The dedupe reversal below. | Concat restored; three equivalence correspondences pinned as tests. |
| R3 | The conflict message `JSON.stringify`d both values — leaking MCP tokens / auth headers from a config-file-built draft, 60 lines from the V5 rule that says report the shape, never the content. | The message reports `shapeOf(value)` (type, arity, key names). Regression test asserts a planted secret never appears. |
| R3b | `setOnce(field, undefined)` silently consumed the slot. | `undefined` is a no-op. |
| R4 | The V5 validation accepted only strings, rejecting the `InlineSkill` objects `compileSkillsSelection` accepts — making the layer strictly LESS expressive than the path it claims equivalence with. | Accepts `string \| InlineSkill`; regression test covers a mixed array. |
| R5 | The gap pin was structurally incapable of failing: it unioned its own answer into the question, derived the universe from the NON-deleted compiler, missed `parseThinkTags`/`stripToolDialect`/`recoverLeakedToolCalls`, and falsely listed `skillsResolver` as expressible. | Universe is now the waist TYPE (`satisfies keyof CompiledAgentOptions` + a compile-time exhaustiveness check, so a new field cannot go unclassified); `expressible` is derived by applying every capability. **Verified failing in both directions**: a fabricated field fails the assertion, and omitting a real gap field fails two tests. |
| R6 | The live proof was executed by nothing and did not even typecheck. | It is a `*.test.ts` under a dedicated `test:live` target (kept out of the deterministic suite per `rules/testing.md` § 3, since it hits a real provider) and is typechecked by the root tsconfig. |

### The dedupe reversal (a fix that was itself the defect)

Round 2 added a dedupe to `skills`. Probing it against the reference showed the dedupe was the ONLY
remaining divergence in the whole milestone:

```
single capability : cap ['a','a']  ≡ ref ['a','a']   ✅
merged capabilities: cap ['a','b'] vs ref ['a','a','b'] ❌  (dedupe collapsed the author's own duplicate)
```

The faithful rule is that **the capability list IS the authoring list, concatenated in order**:
`skills(['a']) + skills(['a'])` corresponds to authoring `['a','a']`, which the reference maps to
`['a','a']`. Under that rule nothing is "manufactured" — the duplicate is what the author wrote.
Dedupe looks tidier and is behaviorally harmless, but it breaks the milestone's one contract
(zero behavior change), so it was removed and the three correspondences are now pinned as tests
(`capability.test.ts § the capability list IS the authoring list`).

Lesson recorded because it cost a round: an adversarial review finding is a hypothesis to VERIFY,
not an instruction to obey. Round 2's fix was applied without first measuring the claim.

### Inline-skill validation had a hole one level down

`skills([{ name: 'x' }])` was accepted. `InlineSkill extends Skill` requires `name`, `description`
AND `instructions` (`@theokit/sdk` `create-skill.d.ts` + `internal/runtime/skills/discover-skills.d.ts`),
so a malformed inline skill reached the `<skills>` system-prompt block with `undefined` fields —
the silent-corruption class the boundary validation exists to stop, reopened below the array check.
Now all three fields are required; the message names the missing FIELD, never the value.

## DoD deviations (recorded, not hidden)

The M52 DoD asks for `AgentSpecDraft` + `SdkAgentAdapter` and the trio `model`/`tools`/`sandbox`.
Two deliberate deviations:

1. **`AgentSpecDraft` / `SdkAgentAdapter` were REUSED, not created** — `CompiledAgentOptionsDraft` +
   `assembleM8CreateOptions` already exist (ADR § 1). Creating them would have been the third
   representation this milestone exists to eliminate.
2. **`sandbox` is not a field of `CompiledAgentOptions`** — there is nothing to set. `skills` took
   its place as the third capability. Adding a `sandbox` field would be a behavior change, the
   opposite of the milestone's contract.

Honest residue: `setOnce`'s deep equality compares FUNCTIONS by identity, so fields carrying
functions stay identity-idempotent rather than value-idempotent. That asymmetry is now stated at
the call site instead of being contradicted by an over-promising comment.

The live run (`tests/live/live-m52-capability.test.ts`) exposed one more: `assembleM8CreateOptions` is a
PARTIAL projection (M8 extras only) — the model reaches `Agent.create` through
`buildModelSelection`, exactly as `sdk-adapter.ts:669` does. The live path composes both instead of
assuming one carries everything.

## Alternatives considered

- **Keep decorators as sugar over capabilities during a deprecation window.** Rejected: backward
  compatibility was explicitly waived, so the sugar would be code written to be deleted next
  milestone while every one of its costs (`reflect-metadata`, `experimentalDecorators`, two code
  paths to test) stayed alive. Re-work by construction.
- **Plain options object, no patterns.** Rejected: it cannot express file-based authoring
  (needs the registry), presets-as-one-unit (needs Composite), or conflict provenance.
