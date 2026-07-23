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

It has no state and no validation of its own; a class would be ceremony. It is kept in the
codebase deliberately as the in-repo proof that "maximum patterns" is bounded by KISS, and it
**delegates to `compileSkillsSelection`** rather than reimplementing the settings shape.

## Consequences

- **Positive.** One waist, one adapter, three authoring routes (fluent, preset, file) that provably
  converge. Conflicts fail fast and typed (`CapabilityConflictError`) where decorators silently
  let the last write win. Provenance makes composition auditable. No `reflect-metadata`, no
  `experimentalDecorators` in the new path.
- **Negative.** Thirteen named patterns is more vocabulary than a plain options object would need;
  a reader must learn `Capability` before contributing one. Mitigated by the contract being two
  members (`name`, `apply`).
- **Proof obligation (met).** `tests/unit/capability-zero-behavior.test.ts` asserts the capability
  path deep-equals `compileAgentDefinition` at the waist AND produces identical
  `assembleM8CreateOptions` output — including via the registry (file) route. This proof is what
  authorizes M53 to delete the decorator source.

### How the proof caught a real divergence

The first run of the byte-identity test FAILED: the hand-written `skills` capability emitted
`{ enabled }` while the canonical compiler emits `{ enabled, autoInject: true }`. The fix was to
delegate to `compileSkillsSelection` (Don't-Reinvent, §9), and three earlier unit expectations
that had encoded the wrong shape were corrected. Without the zero-behavior gate, that divergence
would have shipped silently and surfaced as behavior drift after M53's deletion.

## Alternatives considered

- **Keep decorators as sugar over capabilities during a deprecation window.** Rejected: backward
  compatibility was explicitly waived, so the sugar would be code written to be deleted next
  milestone while every one of its costs (`reflect-metadata`, `experimentalDecorators`, two code
  paths to test) stayed alive. Re-work by construction.
- **Plain options object, no patterns.** Rejected: it cannot express file-based authoring
  (needs the registry), presets-as-one-unit (needs Composite), or conflict provenance.
