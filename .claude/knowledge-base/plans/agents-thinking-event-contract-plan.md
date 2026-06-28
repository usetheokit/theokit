# Plan: Add AgentThinkingEvent to the AgentEvent wire contract

> **Version 1.0** — Add an additive, non-breaking `AgentThinkingEvent` ({ type: 'thinking'; content: string }) to the public `AgentEvent` discriminated union in `packages/theo/src/core/contracts/agent-events.ts`, exported from `theokit/client`, so the model's reasoning/thinking (which `@theokit/agents` already emits, and which downstream apps like theocode want to surface) can flow through the canonical wire contract instead of being undefinable at the consumer's translation boundary.

## Goal

> Add a fifth variant `AgentThinkingEvent` to the `AgentEvent` union so consumers can type-narrow `{ type: 'thinking', content: string }`, measured by the type test `tests/type/agent-thinking-event.test-d.ts` (asserts the variant is assignable to `AgentEvent` and `Extract<AgentEvent,{type:'thinking'}>` has `content: string`) AND the runtime test `parseSSEChunk` round-tripping a thinking SSE line — both green via `pnpm test`.

## Context

theocode's live UX does not surface the model's thinking. Root cause (traced 2026-06-28): `@theokit/agents` ALREADY emits thinking at the stream layer (`packages/agents/src/bridge/agent-stream-events.ts:33-36` `ThinkingEvent { type:'thinking'; content:string }`; `bridge/event-translator.ts:155-157` maps SDK thinking → it), but the higher-level PUBLIC contract `AgentEvent` in the `theo` package (`packages/theo/src/core/contracts/agent-events.ts:93-97`) has only `message | tool_call | tool_result | error`. A consumer that depends on this contract (theocode imports `AgentEvent` from `theokit/client`) therefore cannot represent thinking and drops it at its own translation boundary.

This plan is **framework-first** (radar thesis): the framework's wire contract should carry the capability the layer below already produces. It is Cycle 1 of two — Cycle 1 (this plan) makes the contract type exist + exported; Cycle 2 (theocode, separate repo/plan) consumes it (maps `@theokit/agents` thinking → `AgentThinkingEvent`, renders, persists). This plan changes ONLY the contract type and its exports — it renders nothing and does not touch `@theokit/agents`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theo/src/core/contracts/agent-events.ts` | 98 | `git log -1` (architecture-cleanup move; ADR-0001 v3 exception) | Canonical home for the `AgentEvent` SSE wire-format contract; server emits, client consumes | Discriminated-union-by-`type`; all 4 existing variants unchanged; additive only; < 500 LoC (G6) |
| `packages/theo/src/core/contracts/index.ts` | — | (contracts barrel) | Re-exports the contract types from `core/contracts` | Existing re-exports unchanged; additive |
| `packages/theo/src/client/index.ts` | — | (T1.1 re-export AgentEvent for client consumers) | Public `theokit/client` surface re-exporting `AgentEvent` + variants | Existing re-exports unchanged; additive; `theokit/client` is the surface theocode imports |
| `tests/type/agent-thinking-event.test-d.ts` (NEW) | 0 | — | Type-level proof the variant is assignable + narrows to `content: string` | n/a (new) |
| `tests/unit/agent-stream-derivations.test.ts` | — | (existing `parseSSEChunk`/`deriveLiveText` unit tests) | Runtime tests for the client SSE parse + derivations | Existing assertions stay green; additive tests only |

Every file in any `#### Files to edit` block appears here.

### Current callers / dependents

- **Symbol:** `AgentEvent` (union) in `packages/theo/src/core/contracts/agent-events.ts:93`
  - **Re-exported via:** `core/contracts/index.ts:18` and `client/index.ts:55-60` (alongside `AgentMessageEvent`/`AgentToolCallEvent`/`AgentToolResultEvent`/`AgentErrorEvent`).
  - **Consumers (production, theo):** `client/use-agent-stream.ts` (`deriveLiveText` filters `type==='message'`; `deriveError` filters `type==='error'`; `useAgentStream` stores `AgentEvent[]`), `client/agent-tool-cards.ts` (folds, filters `tool_call`/`tool_result`), `client/agent-stream-core.ts` (`parseSSEChunk` casts parsed JSON to `AgentEvent`), `server/agent/agent-types.ts` (re-export), `server/agent/stream-agent-run.ts` (SDK→AgentEvent producer for SSE), `server/define/define-agent-endpoint.ts` (`encodeSSE`).
  - **External (other repos):** `theocode` consumes `AgentEvent` via `theokit/client`. Cycle 2 will add the `thinking` arm in theocode's `toAgentEvent`.
  - **Exhaustive switches over `AgentEvent.type`:** NONE in `packages/theo/src` (`grep "case 'tool_result'"` → no match; consumers use `.filter(type===X)` / `if`-guards / JSON cast). Adding a variant is therefore additive-safe — no existing `switch` becomes non-exhaustive.

### Domain glossary

- **`AgentEvent`** — the SSE wire contract: discriminated union by `type`, server-emitted, client-consumed (`agent-events.ts`).
- **`AgentThinkingEvent`** — the NEW variant: `{ type: 'thinking'; content: string }` — carries the model's reasoning text. Mirrors `@theokit/agents` `ThinkingEvent` exactly.
- **`parseSSEChunk`** — `client/agent-stream-core.ts:45`: parses one SSE `data:` line into an `AgentEvent` (JSON cast).
- **`deriveLiveText`** — `client/use-agent-stream.ts:12`: folds `AgentEvent[]` → concatenated text, filtering `type==='message'` only.
- **`@theokit/agents` `ThinkingEvent`** — the stream-layer event the agents package already emits (`agent-stream-events.ts:33-36`); the shape this contract variant mirrors.

### Architecture boundaries affected

- **G1 / `system-design-guardrails.md` (dependency direction):** respected — `core/contracts/agent-events.ts` does NOT import `@theokit/agents`. The variant is DEFINED fresh (mirroring the shape by convention), NOT imported, to avoid pointing `theo` core/contracts at `@theokit/agents` (wrong direction). The 2-field shape duplication across packages is intentional (see ADR D2).
- **G3 / `type-safety.md` (Zod SSoT):** `AgentEvent` is a hand-authored wire/discriminated-union contract (not a Zod-derived type — it predates and is the SSE serialization contract; `agent-events.ts` header documents this as the canonical home). Adding an `interface` variant here is consistent with the existing 4 hand-authored `interface` variants — no Zod schema is being duplicated.
- **G6 (file size ≤ 500 LoC):** `agent-events.ts` 98 → ~110 LoC after the additive variant; well under budget.
- **G7 (every export has a consumer):** `AgentThinkingEvent` is referenced in-repo by the `AgentEvent` union (member) and re-exported as public API for external consumers (theocode, Cycle 2). Not orphan.

## Prior Art & Related Work

- **In-repo shape to mirror:** `@theokit/agents` `packages/agents/src/bridge/agent-stream-events.ts:33-36` — `ThinkingEvent { type:'thinking'; content:string }`. The new contract variant copies this shape verbatim so the two layers agree on the wire form.
- **In-repo producer that already maps thinking:** `@theokit/agents` `packages/agents/src/bridge/event-translator.ts:155-157` — proves the framework already surfaces thinking at the stream layer; the gap is solely the higher-level `theo` contract.
- **In-repo contract template:** the 4 existing variants in `packages/theo/src/core/contracts/agent-events.ts:38-87` (`AgentMessageEvent` is the closest analog — `{ type; content; id? }`) are the structural template for `AgentThinkingEvent`.
- **Consumer (Cycle 2, separate repo):** theocode `server/runtime/agents-event-translator.ts:30-63` `toAgentEvent` currently returns `null` for thinking (`default` arm) — it will gain a `thinking` arm once this contract ships. Out of scope here.

## Objective

- [ ] `AgentThinkingEvent` interface exists in `agent-events.ts` with shape `{ type: 'thinking'; content: string; id?: string }`.
- [ ] `AgentEvent` union includes `AgentThinkingEvent` as a fifth member.
- [ ] `AgentThinkingEvent` is re-exported from `core/contracts/index.ts` AND `client/index.ts` (so `theokit/client` exposes it).
- [ ] The 4 existing variants and the union's existing members are unchanged (additive, non-breaking).
- [ ] No exhaustive `switch` over `AgentEvent` in `packages/theo/src` is broken (audited: none exists).
- [ ] No public API removal; `@theokit/agents` untouched; nothing rendered.

## ADRs

### D1 — Add `AgentThinkingEvent` as a fifth `AgentEvent` variant, exported from `theokit/client`
- **Decision:** Define `interface AgentThinkingEvent { type: 'thinking'; content: string; id?: string }` in `agent-events.ts`, add it to the `AgentEvent` union, and re-export it from `core/contracts/index.ts` + `client/index.ts`. Shape mirrors `@theokit/agents` `ThinkingEvent` (`type`+`content`) plus the optional `id?` that every other variant in this contract already carries (dedup/animation keys, per `AgentMessageEvent` line 41-42).
- **Rationale:** The contract is the seam between producers and consumers; for thinking to flow end-to-end a consumer must be able to type-represent it. Additive variant = zero breakage for code that switches on the known 4 types (no exhaustive switch exists in-repo). Including `id?` matches the contract's existing convention (consistency) and lets a client dedup/key thinking segments.
- **Alternatives considered:** (a) theocode defines its own local `thinking` event type (the "só theocode / canal lateral" option) — REJECTED by the user (radar thesis: the framework contract should carry the capability, not an app-side fork). (b) `content` omitted, thinking signalled by `type` only — REJECTED: consumers need the reasoning text to render a "Pensou por Ns"/expandable block. (c) name it `reasoning` — REJECTED: `@theokit/agents` already uses `thinking`; matching it avoids a translation rename.
- **Consequences:** Enables Cycle 2 (theocode) to map + render + persist thinking. Constrains: the wire form is now part of the public contract — future changes are breaking (acceptable; it is the right home).

### D2 — Define the variant fresh (mirror shape); do NOT import `@theokit/agents` into `theo` core/contracts
- **Decision:** Hand-author `AgentThinkingEvent` in `agent-events.ts` rather than importing/re-exporting `@theokit/agents` `ThinkingEvent`.
- **Rationale:** G1 dependency direction — `theo` core/contracts importing `@theokit/agents` would create a wrong-direction coupling (and `@theokit/agents` is a sibling runtime layer, not a dependency of core/contracts). DRY is about KNOWLEDGE; here the "knowledge" is a 2-field wire shape that already exists independently in two layers for two protocols (the agents stream event vs the theo SSE contract). Duplicating a trivial shape is cheaper than coupling the contract package to the agents package (DRY-vs-architecture tension resolved in favor of the boundary, per `parsimony-ladder.md` / DRY-is-knowledge).
- **Alternatives considered:** (a) `export type { ThinkingEvent as AgentThinkingEvent } from '@theokit/agents'` — REJECTED: violates G1 dependency direction + forces a runtime dep on a type-only contract package. (b) Extract a shared `@theokit/contracts` package — REJECTED: YAGNI for one 2-field type; over-engineering.
- **Consequences:** The two shapes must stay in agreement by convention. Mitigated by Cycle 2's mapping test (theocode asserts `@theokit/agents` thinking → `AgentThinkingEvent` round-trips), which fails loudly if the shapes drift.

### D3 — Do NOT wire `theo`'s own SSE producer (`stream-agent-run.ts`) to emit thinking in this cycle
- **Decision:** Leave `packages/theo/src/server/agent/stream-agent-run.ts` (the `theo`-framework SDKMessage→AgentEvent SSE mapper) unchanged in this cycle; document the follow-up.
- **Rationale:** The user-stated consumer (theocode) does NOT use `stream-agent-run.ts` — it consumes `@theokit/agents` `AgentRunner.stream()` (which already emits thinking) + its own `toAgentEvent`. The contract type is the only thing theocode needs. Wiring `stream-agent-run.ts` adds production behavior + tests for a path no current consumer exercises — YAGNI, and the user explicitly scoped Cycle 1 to the contract ("NÃO renderizar nada"). The variant is NOT orphan (referenced by the union + public export).
- **Alternatives considered:** Emit thinking from `stream-agent-run.ts` now — REJECTED: scope creep beyond the contract; no current theo-framework consumer requested it; can be a clean follow-up when a theo-framework app needs thinking on its native SSE path.
- **Consequences:** `theo`-framework apps using `defineAgentEndpoint` + `stream-agent-run.ts` will not yet receive thinking on the wire (only theocode's `@theokit/agents` path does). Documented as a known follow-up, not a regression (nothing emitted thinking before).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The new variant is part of the public wire contract — future changes to its shape are breaking | Low | The shape mirrors the established `@theokit/agents` `ThinkingEvent` (`type`+`content`), already battle-proven; `id?` matches the contract's existing optional-id convention. Right home for the type. | theo |
| `theo`'s own SSE producer (`stream-agent-run.ts`) does not emit the variant yet (D3) | Low | Documented follow-up; theocode (the actual consumer) uses the `@theokit/agents` path that already emits thinking; nothing emitted thinking before, so no regression. | theo |
| Shape drift between `@theokit/agents` `ThinkingEvent` and `AgentThinkingEvent` (two copies, D2) | Low | Cycle 2's theocode mapping test round-trips `@theokit/agents` thinking → `AgentThinkingEvent` and fails loudly on drift; both are trivial 2-field shapes. | theo / theocode |
| An external consumer with an exhaustive `switch (event.type)` + `default: assertNever` could now hit the new `thinking` case at runtime | Medium | Additive variant is the standard non-breaking way to extend a discriminated union; in-repo there is NO exhaustive switch (audited). External consumers (theocode) opt in by adding a `thinking` arm in Cycle 2; until then a `thinking` event simply isn't produced for them by theo's path. | theo |

## Unresolved Questions

- (none — every decision is resolved at plan time). The `@theokit/agents` `ThinkingEvent` shape, the contract's export sites, the absence of exhaustive switches, and the test locations are all verified with file:line citations above.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `vitest` | (installed, dev) | npm | Runs the new `tests/type/*.test-d.ts` (typecheck project) + `tests/unit/*.test.ts`. Already the test runner; no version change. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | No new runtime/dev dependency. The change is a TypeScript type variant + re-exports; no library is needed. | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Dependency Graph

```
Phase 1 (contract variant + exports + type test) ──▶ Phase 1 (consumer additivity runtime tests) ──▶ Final Phase (Integration Validation)
```

Single coherent phase across one source file + two barrels + two test files. T1.2 depends on T1.1 (its tests reference the new type). Sequential.

---

## Phase 1: Add the contract variant, export it, prove additivity

**Objective:** `AgentThinkingEvent` exists in the union, is exported from `theokit/client`, and is proven additive-safe for existing consumers.

### T1.1 — Add `AgentThinkingEvent` + union member + exports

#### Objective
Add the `interface AgentThinkingEvent { type:'thinking'; content:string; id?:string }`, include it in the `AgentEvent` union, and re-export it from both `core/contracts/index.ts` and `client/index.ts`.

#### Why this step (action + reasoning)
1. **What this step does** — introduces the fifth variant in `agent-events.ts` (mirroring `@theokit/agents` `ThinkingEvent` + the contract's `id?` convention) and surfaces it on the public `theokit/client` export so external consumers (theocode, Cycle 2) can import the type.
2. **Why it is necessary now** — D1: it is the entire deliverable of Cycle 1. The type must exist + be exported before theocode (Cycle 2) can type-narrow `{type:'thinking'}` in its `toAgentEvent`. It must land first because T1.2's tests reference the new type.

#### Evidence
- Contract + union: `packages/theo/src/core/contracts/agent-events.ts:38-43` (`AgentMessageEvent` analog with `id?`), `:93-97` (union).
- Shape to mirror: `packages/agents/src/bridge/agent-stream-events.ts:33-36`.
- Export sites: `packages/theo/src/core/contracts/index.ts:14-19`; `packages/theo/src/client/index.ts:54-60`.

#### Files to edit
```
packages/theo/src/core/contracts/agent-events.ts — add AgentThinkingEvent interface + add it to the AgentEvent union
packages/theo/src/core/contracts/index.ts — add AgentThinkingEvent to the agent-events re-export block
packages/theo/src/client/index.ts — add AgentThinkingEvent to the agent-events re-export block
tests/type/agent-thinking-event.test-d.ts — (NEW) RED type test, added first (TDD)
```

#### Deep file dependency analysis
- `agent-events.ts` exports 4 `interface`s + the `AgentEvent` union. Adding a 5th interface + union member is additive — the 4 existing variants and their fields are untouched.
- `core/contracts/index.ts:14-19` and `client/index.ts:55-60` each `export type { ... } from '../core/contracts/agent-events.js'` listing the 4 variants + `AgentEvent`. Adding `AgentThinkingEvent` to both lists is additive.
- Downstream consumers (`use-agent-stream.ts`, `agent-tool-cards.ts`, `agent-stream-core.ts`) reference `AgentEvent` by filter/cast, not by exhaustive switch → unaffected.

#### Deep Dives
- **Variant shape:** `export interface AgentThinkingEvent { type: 'thinking'; content: string; /** Optional id for client-side dedup / animation keys. */ id?: string }` — placed after `AgentErrorEvent`, with a JSDoc block noting it mirrors `@theokit/agents` `ThinkingEvent` and carries the model's reasoning text.
- **Union:** append `| AgentThinkingEvent` to `AgentEvent` (and update the doc comment "4 variants" → "5 variants" at line 90).
- **Invariants:** additive only; no field changes to existing variants; no `any`/`as`; < 500 LoC.

#### Pseudo-code / Signatures
```pseudocode
export interface AgentThinkingEvent {
  type: 'thinking'
  content: string          // model reasoning text (mirrors @theokit/agents ThinkingEvent)
  id?: string
}
export type AgentEvent =
  | AgentMessageEvent | AgentToolCallEvent | AgentToolResultEvent | AgentErrorEvent
  | AgentThinkingEvent
```

#### Tasks
1. Write the RED type test (`tests/type/agent-thinking-event.test-d.ts`) asserting the variant is assignable to `AgentEvent` and narrows to `content:string`.
2. Add the interface + union member (GREEN) in `agent-events.ts`; bump the "4 variants" doc to "5".
3. Add `AgentThinkingEvent` to both export blocks (`core/contracts/index.ts`, `client/index.ts`).

#### TDD
```
RED:     test-d: expectTypeOf<{type:'thinking';content:string}>().toMatchTypeOf<AgentEvent>() — fails to compile before the variant exists
RED:     test-d: expectTypeOf<Extract<AgentEvent,{type:'thinking'}>>().toEqualTypeOf<AgentThinkingEvent>() and .content is string
GREEN:   Add the interface + union member + exports
REFACTOR: none expected (additive)
VERIFY:  pnpm test (runs the tests/type typecheck project)
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — a TypeScript type/contract change; no runtime concurrency, locks, async, or shared state touched.

#### Acceptance Criteria
- [ ] Type test green — `pnpm test -- agent-thinking-event` (the `tests/type` typecheck project) exits 0 with the new assertions passing.
- [ ] `AgentThinkingEvent` importable from `theokit/client` — `grep -n "AgentThinkingEvent" packages/theo/src/client/index.ts` returns the re-export line.
- [ ] Pass: lint — `npx eslint packages/theo/src/core/contracts/agent-events.ts packages/theo/src/core/contracts/index.ts packages/theo/src/client/index.ts` exits 0.
- [ ] Pass: size — `wc -l packages/theo/src/core/contracts/agent-events.ts` returns ≤ 500.
- [ ] Existing variants unchanged — `git diff packages/theo/src/core/contracts/agent-events.ts` shows only additions (no `-` lines except the "4 variants"→"5 variants" doc).

#### DoD
- [ ] All tasks completed and validated.
- [ ] `pnpm test` green (type + unit projects).
- [ ] `npx tsc --noEmit -p packages/theo/tsconfig.json` zero errors.
- [ ] `npx eslint packages/theo` zero warnings on touched files.
- [ ] File-size budget respected.

### T1.2 — Prove additivity for existing client consumers (runtime tests)

#### Objective
Add runtime tests proving the new variant is additive-safe: `parseSSEChunk` round-trips a `thinking` SSE line into the typed shape, and the existing folds (`deriveLiveText`, `foldAgentToolCards`/agent-tool-cards) ignore thinking (no pollution).

#### Why this step (action + reasoning)
1. **What this step does** — characterizes the additive contract: a `thinking` event parses correctly and does NOT leak into text or tool-card derivations.
2. **Why it is necessary now** — D1/D3: it locks the additive guarantee so a future edit can't silently make `deriveLiveText` concatenate thinking into the assistant text (which would regress the UX). Depends on T1.1 (tests reference the new type).

#### Evidence
- `parseSSEChunk` — `packages/theo/src/client/agent-stream-core.ts:45-50` (JSON cast to `AgentEvent`).
- `deriveLiveText` filters `type==='message'` — `packages/theo/src/client/use-agent-stream.ts:12`.
- `agent-tool-cards.ts` folds only `tool_call`/`tool_result` — `:63,116`.
- Test home — `tests/unit/agent-stream-derivations.test.ts` (existing parse/derivation tests).

#### Files to edit
```
tests/unit/agent-stream-derivations.test.ts — add RED tests: parseSSEChunk(thinking line) → {type:'thinking',content}; deriveLiveText ignores thinking; agent-tool-cards ignore thinking
```

#### Deep file dependency analysis
- These are additive characterization tests over EXISTING functions. No production code change is expected — `deriveLiveText`/`agent-tool-cards` already filter by specific `type`, so thinking is ignored by construction; `parseSSEChunk` already round-trips any `AgentEvent` JSON. The tests fail to COMPILE before T1.1 (the type doesn't exist) → RED; pass after → GREEN.
- If any consumer is found to NOT ignore thinking (unexpected), add the minimal guard there (none anticipated).

#### Deep Dives
- **parseSSEChunk test:** `parseSSEChunk('data: {"type":"thinking","content":"reason"}')` → `{type:'thinking',content:'reason'}`.
- **deriveLiveText test:** input `[{type:'message',content:'Hi'},{type:'thinking',content:'reason'}]` → `'Hi'` (thinking NOT concatenated).
- **agent-tool-cards test:** input with a `thinking` event interleaved → tool-card fold output unaffected (thinking ignored).
- **Edge cases:** empty `content` thinking parses to `{type:'thinking',content:''}`; thinking-only event list → `deriveLiveText` returns `''`.

#### Pseudo-code / Signatures
```pseudocode
test parseSSEChunk thinking → expect {type:'thinking',content:'reason'}
test deriveLiveText([message 'Hi', thinking 'reason']) → expect 'Hi'
test foldAgentToolCards([thinking, tool_call, tool_result]) → expect cards from tool_* only
```

#### Tasks
1. Write the RED runtime tests (parse round-trip + two ignore-thinking folds).
2. Run `pnpm test`; confirm GREEN with no production change (or add the minimal guard if a fold unexpectedly pollutes).

#### TDD
```
RED:     test_parseSSEChunk_parses_thinking_event() — data line → {type:'thinking',content}
RED:     test_deriveLiveText_ignores_thinking() — message+thinking → only message text
RED:     test_agent_tool_cards_ignore_thinking() — thinking interleaved → cards unchanged
GREEN:   (no production change expected — filters already specific); add guard only if a test proves pollution
REFACTOR: none expected
VERIFY:  pnpm test -- agent-stream-derivations
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — pure synchronous parse/fold functions; no concurrency.

#### Acceptance Criteria
- [ ] All three runtime tests green — `pnpm test -- agent-stream-derivations` exits 0.
- [ ] `deriveLiveText` proven to ignore thinking (no text pollution) — asserted by `test_deriveLiveText_ignores_thinking`.
- [ ] Pass: lint — `npx eslint tests/unit/agent-stream-derivations.test.ts` exits 0.
- [ ] No unexpected production change — if T1.2 required editing a consumer, it is the minimal guard and noted in the implementation log; otherwise the diff is test-only.

#### DoD
- [ ] All tasks completed and validated.
- [ ] `pnpm test` green.
- [ ] `npx tsc --noEmit -p packages/theo/tsconfig.json` zero errors.
- [ ] CHANGELOG `[Unreleased]` updated (Unbreakable Rule 6).

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `AgentThinkingEvent` variant exists in the `AgentEvent` union | T1.1 | interface + union member (D1) |
| 2 | Variant exported from `theokit/client` (theocode can import the type) | T1.1 | re-export in `core/contracts/index.ts` + `client/index.ts` |
| 3 | Additive / non-breaking for existing variants | T1.1 | git-diff additions-only AC; doc "4→5" only |
| 4 | No exhaustive switch broken | T1.1 | audited (none in-repo); AC + Baseline Context |
| 5 | Thinking does not pollute text/tool-card derivations | T1.2 | `deriveLiveText`/`agent-tool-cards` ignore-thinking tests |
| 6 | `thinking` event round-trips through the SSE parse | T1.2 | `parseSSEChunk` test |
| 7 | `@theokit/agents` untouched; nothing rendered | T1.1, T1.2 | scope discipline (D3); no edits under `packages/agents` |

**Coverage: 7/7 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — `pnpm test` green (type + unit projects).
- [ ] Zero type errors — `npx tsc --noEmit -p packages/theo/tsconfig.json`.
- [ ] Zero lint warnings — `npx eslint packages/theo` + the new test files on touched files.
- [ ] File-size budget respected — `agent-events.ts` < 500.
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6).
- [ ] Backward compatibility preserved — 4 existing variants + union members unchanged; additive only; no exhaustive switch broken.
- [ ] Plan-specific: type test green (variant assignable + narrows to `content:string`); `deriveLiveText` ignore-thinking green.
- [ ] **Runtime-metric proof** — n/a (a type contract; behavioral proof is the parse round-trip + ignore-thinking tests in the suite).
- [ ] **Plan archived** — after `/review` = READY_TO_MERGE AND PR merged, move this plan to `knowledge-base/plans/completed/`.

## Failure scenarios (when I/O external)

(none — no external I/O touched). This cycle adds a TypeScript type variant + re-exports + tests. No HTTP client, DB, queue, RPC, or object store is touched. `parseSSEChunk` parses an in-memory string (no network).

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the additive contract change in the full theo suite — not just the new tests.

### Execution
```
pnpm test                                              # full type + unit + integration suite (root runner)
npx tsc --noEmit -p packages/theo/tsconfig.json        # zero type errors
npx eslint packages/theo                               # lint (touched files zero warnings)
wc -l packages/theo/src/core/contracts/agent-events.ts # < 500 (G6)
grep -n "AgentThinkingEvent" packages/theo/src/client/index.ts  # export present
```

### Acceptance Criteria
- [ ] All test suites green — `pnpm test` exits 0 (no regression in `use-agent-stream`/`agent-stream-derivations`/`define-agent-endpoint` callers).
- [ ] Type test green — `tests/type/agent-thinking-event.test-d.ts` passes (variant assignable + narrows).
- [ ] Zero type errors — `npx tsc --noEmit -p packages/theo/tsconfig.json` exits 0.
- [ ] Zero lint warnings — `npx eslint packages/theo` exits 0 on touched files.
- [ ] Export surface proven — `AgentThinkingEvent` re-exported from `theokit/client` (grep) so theocode (Cycle 2) can import it.
- [ ] Additivity proven — `git diff` on `agent-events.ts` shows only additions (+ the "4→5 variants" doc edit).

### If Validation Fails
1. Separate plan-caused failures from pre-existing baseline (document any pre-existing eslint/test issues in untouched files).
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Pre-existing issues logged in the PR description, do not block.
