---
slug: m5-client-stream
milestone_id: M5
created_at: 2026-06-21
goal: Add liveText + error derived fields to useAgentStream (M5-1) and a foldAgentToolCards(events)/useAgentToolCards() correlator (M5-2) to theokit/client, measured by tests/unit/agent-stream-derivations.test.ts passing green.
---

# Plan: M5-1 + M5-2 — `theokit/client` stream derivations

> **Version 1.1** (edge-case-plan absorbed: EC-1 default resolver parses JSON-string `tool_result.data` + EC-2 orphan result folded into T1.2 TDD; EC-3 duplicate-id last-wins + EC-4 liveText-concat documented) — Close roadmap gaps M5-1 + M5-2 (same subsystem, one cycle): the `useAgentStream` hook returns raw `AgentEvent[]`, so the `create-theokit` default template + the `@theokit/ui` showcase hand-roll `switch(event.type)` to derive the live assistant text, the error, and correlated tool cards. M5-1 adds two pure derived fields to `UseAgentStreamReturn` — `liveText` (accumulated `message` content) + `error` (the `AgentErrorEvent`, or `undefined`). M5-2 adds `foldAgentToolCards(events, { resolveEnvelope? })` (pure: correlate `tool_call`→`tool_result` by `id` into `AgentToolCard[]` with `running`/`success`/`error` status, via an injectable tool-result envelope resolver) + `useAgentToolCards(path, options?)` (the hook + folded cards). Pure, framework-aligned, zero new deps.

## Goal

> "Add `liveText`/`error` to `useAgentStream` and a `foldAgentToolCards`/`useAgentToolCards` correlator so the template + showcase stop hand-rolling `switch(event.type)`, measured by `pnpm exec vitest run tests/unit/agent-stream-derivations.test.ts` reporting all tests passed."

## Context

Roadmap gaps M5-1 (`docs/gap-audit/ROADMAP.md:161`, med/S) + M5-2 (`:162`, high/M), Tema D, dep M1-5. `useAgentStream` (`packages/theo/src/client/use-agent-stream.ts:46`) returns `{ events, status, send, abort, reset }` — consumers must fold `events` themselves. The `create-theokit` default template (`packages/create-theokit/templates/default/app/page.tsx:110`) hand-rolls a `switch(event.type)` to build message/tool/error items, treating `tool_call` and `tool_result` as SEPARATE uncorrelated items. The `AgentEvent` contract (`packages/theo/src/core/contracts/agent-events.ts`) is a discriminated union (`message`/`tool_call`/`tool_result`/`error`) with optional `id` for correlation. M5-1+M5-2 ship the derivations as framework primitives so the template + showcase delete their hand-roll. Zero new dependencies (pure reducers + a thin hook over the existing `useAgentStream`).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theo/src/client/use-agent-stream.ts` | 107 | (theo) | the `useAgentStream` hook | existing `{events,status,send,abort,reset}` fields + behavior unchanged; ADD `liveText`/`error` |
| `packages/theo/src/client/agent-tool-cards.ts` (NEW) | 0 | — | `foldAgentToolCards` + `AgentToolCard` + resolver | — |
| `packages/theo/src/client/use-agent-tool-cards.ts` (NEW) | 0 | — | `useAgentToolCards` hook | — |
| `packages/theo/src/client/index.ts` | 56 | (theo) | `theokit/client` barrel | additive exports only |
| `tests/unit/agent-stream-derivations.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `CHANGELOG.md` + `.changeset/` (NEW) | — | — | changelog + changeset (theokit has no public-API doc file; CHANGELOG is the contract) | additive `Added` entry |

### Current callers / dependents

- **Symbol:** `UseAgentStreamReturn` (`use-agent-stream.ts:28`) — exported from `theokit/client` barrel. Adding OPTIONAL-shaped fields (`liveText`/`error` always present, additive) is backward-compatible; existing destructuring (`{ events, status }`) is unaffected.
- **Symbol:** `AgentEvent` union (`core/contracts/agent-events.ts`) — the reducer input; unchanged.
- **External:** `create-theokit` default template (`app/page.tsx:110`) + `@theokit/ui` showcase hand-roll the fold (the gap's target consumers).

### Domain glossary

- **AgentEvent** — discriminated union: `message{content,id?}` / `tool_call{name,args,id?}` / `tool_result{name,data,id?}` / `error{message,code?,…,id?}`.
- **liveText** — the accumulated assistant text: the concatenation of every `message` event's `content`.
- **tool card** — a UI-facing correlated view of one tool invocation: `{ id, name, args, status, result? }`.
- **envelope resolver** — an injectable `(data) => { error: boolean }` that classifies a `tool_result.data` payload (e.g. an sdk-tools `{ok:false}` JSON) as success/error.

### Architecture boundaries affected

Per `rules/architecture.md`: `agent-tool-cards.ts` is a pure reducer (no React, no I/O) → importable by both the hook and non-React consumers. `use-agent-tool-cards.ts` composes `useAgentStream` + the reducer. `core/contracts` import is the documented legal exception (`client → core/contracts`). All new exports flow through the `client/index.ts` barrel.

## Prior Art & Related Work

- **Baseline investigation (2026-06-21)** — mapped `useAgentStream` (`use-agent-stream.ts:46`), the `AgentEvent` contract (`agent-events.ts`), and the template hand-roll (`create-theokit/templates/default/app/page.tsx:110`).
- **In-repo precedent** — `agent-stream-core.ts` (`consumeAgentStream`) is the pure transport the hook composes; `core/contracts/agent-events.ts` is the shared union.
- **Consumer prior art (to replace)** — the `create-theokit` default template's `switch(event.type)` fold + the `@theokit/ui` showcase.
- **ADRs** — `knowledge-base/adrs/` ADR-0001 (the `client → core/contracts` legal-import exception); the agent-events contract ADR (Production-Readiness #3, error discrimination).

## Objective

- [ ] `useAgentStream` returns `liveText: string` (accumulated `message` content) + `error: AgentErrorEvent | undefined` (the error event), additive to `UseAgentStreamReturn`.
- [ ] `foldAgentToolCards(events, { resolveEnvelope? }): AgentToolCard[]` correlates `tool_call`→`tool_result` by `id` (FIFO-by-name fallback when `id` absent) into `{ id, name, args, status, result? }`; status `running` (no result) / `success` / `error` (resolver says error).
- [ ] `useAgentToolCards(path, options?)` returns the `useAgentStream` result plus `toolCards: AgentToolCard[]`.
- [ ] All barrel-exported from `theokit/client`; CHANGELOG + changeset (+ docs note).
- [ ] Existing `useAgentStream` fields/behavior unchanged (backward-compat).
- [ ] `tests/unit/agent-stream-derivations.test.ts` green; typecheck + Biome clean.

## ADRs

### D1 — `liveText` = concatenation of all `message` contents; `error` = the error event
**Decision:** `liveText` joins every `message` event's `content` (the accumulated assistant text); `error` is the (last) `AgentErrorEvent` or `undefined`.
**Rationale:** the common UI need is "the streaming assistant text so far" + "did it fail (and why/code)". Concatenation covers both delta- and full-message servers; surfacing the `AgentErrorEvent` (with `code`/`retriable`) lets the UI branch (sign-in CTA, retry countdown) — exactly what the template hand-rolls.
**Alternatives considered:** `liveText` = only the latest message — rejected (loses earlier text on multi-message turns); `error` = just a string — rejected (drops `code`/`retriable` the contract added for client branching).

### D2 — `foldAgentToolCards` is a PURE reducer; the hook composes it
**Decision:** `foldAgentToolCards(events, options?)` is a pure function (no React); `useAgentToolCards` = `useAgentStream` + `useMemo(() => foldAgentToolCards(events, options))`.
**Rationale:** a pure reducer is testable without a DOM, reusable server-side / in non-React consumers, and keeps the hook a thin composition. Mirrors `consumeAgentStream` (pure) + `useAgentStream` (hook) split.
**Alternatives considered:** fold inside the hook only — rejected (untestable without React, not reusable); a class — rejected (functions + plain data are the idiom here).

### D3 — Correlate by `id`, FIFO-by-name fallback; injectable envelope resolver
**Decision:** match a `tool_result` to its `tool_call` by `id` when both have one; when `id` is absent, match the result to the oldest still-`running` card with the same `name`. The `error` status comes from an injectable `resolveEnvelope(data) => { error }` (default: `data` is an object with `ok === false`, OR a JSON string parsing to such).
**Rationale:** `id` is the contract's correlation key but optional; FIFO-by-name is the deterministic fallback. The envelope resolver decouples the correlator from any specific tool-result shape (sdk-tools `{ok,error}` is one; consumers inject their own).
**Alternatives considered:** id-only (drops cards when servers omit id) — rejected; hard-code the sdk-tools envelope — rejected (couples the framework to one tool shape; the resolver is injectable per the roadmap).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `liveText` concatenation assumption (delta vs full message) could double-render if a server sends full-snapshot messages | Low | document the contract (concatenates all `message` contents); a full-snapshot server uses `events` directly | theokit |
| FIFO-by-name fallback mis-correlates interleaved same-name calls without ids | Low | documented; servers SHOULD emit `id` for reliable correlation (the contract supports it); id path is exact | theokit |
| New public surface (5 symbols) must stay supported | Low | thin pure reducer + a hook over the stable `useAgentStream` | theokit |
| Default envelope resolver could misclassify a non-sdk-tools payload | Low | resolver is injectable; default only flags an explicit `ok===false` — anything else is `success` (conservative) | theokit |

## Unresolved Questions

(none — every decision is resolved at plan time. liveText/error semantics (D1), pure-reducer split (D2), id+FIFO correlation + injectable resolver (D3) are locked against the `AgentEvent` contract + the template hand-roll being replaced.)

## Dependencies

M5-1+M5-2 introduce ZERO new dependencies — pure reducers + a hook over the existing `useAgentStream`/`AgentEvent` (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `react` (`useMemo`) | existing peer | npm/TS | the hook (already a dep of `useAgentStream`) |
| `useAgentStream` + `AgentEvent` (in-repo) | workspace | npm/TS | the stream hook + event union |

### New — to be introduced

(none)

## Dependency Graph

```
Phase 1 (liveText/error + foldAgentToolCards + useAgentToolCards) ──▶ Phase 2 (barrel + docs) ──▶ Phase 3 (integration validation)
```

Sequential.

---

## Phase 1: Derivations

**Objective:** add the two hook fields + the tool-card correlator, with TDD.

### T1.1 — `liveText` + `error` on `useAgentStream` (M5-1)

#### Objective
Two pure derived fields on the hook.

#### Why this step (action + reasoning)
1. **What this step does** — adds `liveText`/`error` to `UseAgentStreamReturn` + computes them via `useMemo(events)` in `useAgentStream`.
2. **Why it is necessary now** — they are the M5-1 deliverable; the template hand-rolls exactly these. Additive fields don't touch existing behavior.

#### Evidence
`AgentMessageEvent.content` + `AgentErrorEvent` (`agent-events.ts`); the hook holds `events` (`use-agent-stream.ts:47`). Template derives both at `page.tsx:110`.

#### Files to edit
```
packages/theo/src/client/use-agent-stream.ts — add liveText + error (useMemo over events) + to the return type
tests/unit/agent-stream-derivations.test.ts — RED tests (liveText concat; error from error event; none → "" / undefined)
```

#### Deep file dependency analysis
- `UseAgentStreamReturn` gains `liveText: string` + `error: AgentErrorEvent | undefined`. `useMemo` recomputes on `events` change. No change to `send`/`abort`/`reset`/`status`.

#### Deep Dives
- `liveText = useMemo(() => events.filter(e => e.type === "message").map(e => e.content).join(""), [events])`.
- `error = useMemo(() => { const errs = events.filter(e => e.type === "error"); return errs[errs.length-1]; }, [events])` (last error; `undefined` if none).
- Edge: no message events → `""`; no error → `undefined`.

#### Tasks
1. Write RED tests (via the reducer-extracted helpers or render-hook): liveText concatenates; error returns the event; empty cases.
2. Add the two `useMemo`s + return them; extend the type.

#### TDD
```
RED:     liveText_concatenates_message_contents() — message "a"+"b" → "ab"
RED:     liveText_empty_without_messages() — no message events → ""
RED:     error_returns_last_error_event() — error event surfaced (with code); none → undefined
GREEN:   add liveText/error to the hook
REFACTOR: extract pure deriveLiveText/deriveError(events) helpers for testability
VERIFY:  pnpm exec vitest run tests/unit/agent-stream-derivations.test.ts
```

#### Acceptance Criteria
- [ ] RED tests pass — `pnpm exec vitest run tests/unit/agent-stream-derivations.test.ts` reports all tests passed.
- [ ] Existing `useAgentStream` behavior unchanged (its fields still present).
- [ ] Pass: lint — `pnpm exec biome check packages/theo/src/client/use-agent-stream.ts` reports 0 warnings.

#### DoD
- [ ] `pnpm exec vitest run tests/unit/agent-stream-derivations.test.ts` exits 0
- [ ] Zero type errors — `pnpm exec tsc -p packages/theo/tsconfig.json --noEmit` exits 0 (or the repo's typecheck) 

### T1.2 — `foldAgentToolCards` + `useAgentToolCards` (M5-2)

#### Objective
A pure tool-card correlator + its hook.

#### Why this step (action + reasoning)
1. **What this step does** — adds `agent-tool-cards.ts` (`AgentToolCard`, `foldAgentToolCards`, the default envelope resolver) + `use-agent-tool-cards.ts` (`useAgentToolCards`).
2. **Why it is necessary now** — M5-2 deliverable; the template treats tool_call/tool_result as uncorrelated items — the correlator fixes that into single cards.

#### Evidence
`tool_call{name,args,id?}` + `tool_result{name,data,id?}` (`agent-events.ts`); template's uncorrelated tool items (`page.tsx:115-135`).

#### Files to edit
```
packages/theo/src/client/agent-tool-cards.ts — NEW: AgentToolCard + ToolEnvelopeResolver + foldAgentToolCards
packages/theo/src/client/use-agent-tool-cards.ts — NEW: useAgentToolCards
tests/unit/agent-stream-derivations.test.ts — add RED tests (correlate by id; FIFO-by-name fallback; running/success/error; envelope resolver)
```

#### Deep file dependency analysis
- `agent-tool-cards.ts` imports `AgentEvent` from `../core/contracts/agent-events.js` (legal exception). `use-agent-tool-cards.ts` imports `useAgentStream` + `foldAgentToolCards`.

#### Deep Dives
- Data: `AgentToolCard = { id: string; name: string; args: Record<string,unknown>; status: "running"|"success"|"error"; result?: unknown }`; `ToolEnvelopeResolver = (data: unknown) => { error: boolean }`.
- Fold: iterate events; `tool_call` → push a card `{ id: e.id ?? \`tool-\${i}\`, name, args: e.args, status:"running" }` (track by id + a per-name FIFO queue of running cards). `tool_result` → find the card by `e.id` (if present) else the oldest running card with `name===e.name`; set `result=e.data`, `status = resolveEnvelope(e.data).error ? "error" : "success"`. Orphan `tool_result` (no match) → push a finished card.
- Default resolver: `data` object with `ok===false` → `{error:true}`; a JSON string parsing to such → `{error:true}`; else `{error:false}`.
- Edge: empty events → `[]`. A `tool_call` never resolved stays `running`.

#### Pseudo-code / Signatures
```pseudocode
function foldAgentToolCards(events, opts?): AgentToolCard[]
  resolve = opts?.resolveEnvelope ?? defaultResolveEnvelope
  cards = []; byId = Map; runningByName = Map<name, queue>
  for (e, i) of events:
    if e.type=="tool_call":
      card = { id: e.id ?? `tool-${i}`, name: e.name, args: e.args, status:"running" }
      cards.push(card); if e.id: byId.set(e.id, card); else runningByName.get(name).push(card)
    if e.type=="tool_result":
      card = (e.id && byId.get(e.id)) ?? runningByName.get(e.name)?.shift()
      if !card: card = { id: e.id ?? `tool-${i}`, name: e.name, args:{}, status:"running" }; cards.push(card)
      card.result = e.data; card.status = resolve(e.data).error ? "error" : "success"
  return cards
function useAgentToolCards(path, options?) = { ...useAgentStream(path,options), toolCards: useMemo(fold(events), [events]) }
# Example: [tool_call{name:read,id:1}, tool_result{name:read,id:1,data:{ok:true}}] → [{id:1,name:read,status:"success",result:{ok:true}}]
```

#### Tasks
1. Write RED tests (id-correlate success; envelope ok:false → error; running (no result); FIFO-by-name fallback; orphan result; empty).
2. Implement `agent-tool-cards.ts` + `use-agent-tool-cards.ts`.

#### TDD
```
RED:     fold_correlates_call_result_by_id() — call+result same id → one success card with result
RED:     fold_marks_error_via_envelope() — result data {ok:false} → status "error"
RED:     defaultResolveEnvelope_parses_json_string() — (EC-1) '{"ok":false}' string → error; '{"ok":true}' → success; non-JSON → success
RED:     fold_running_when_no_result() — lone tool_call → status "running"
RED:     fold_fifo_by_name_when_no_id() — id-less call+result same name → correlated
RED:     fold_orphan_result_creates_card() — tool_result with no prior call → finished card
RED:     fold_empty_is_empty() — [] → []
GREEN:   Implement agent-tool-cards.ts + use-agent-tool-cards.ts
REFACTOR: extract defaultResolveEnvelope if cyclomatic > 10
VERIFY:  pnpm exec vitest run tests/unit/agent-stream-derivations.test.ts
```

#### Acceptance Criteria
- [ ] RED tests pass — `pnpm exec vitest run tests/unit/agent-stream-derivations.test.ts` reports all tests passed.
- [ ] Pass: complexity — `pnpm exec biome check packages/theo/src/client/agent-tool-cards.ts` reports 0 warnings (cyclomatic ≤ 10).
- [ ] Pass: size — each new file ≤ 500 lines.

#### DoD
- [ ] `pnpm exec vitest run tests/unit/agent-stream-derivations.test.ts` exits 0
- [ ] Zero type errors — repo typecheck exits 0

---

## Phase 2: Barrel + docs

**Objective:** export the new symbols, document, changelog.

### T2.1 — `client/index.ts` exports + docs/changelog

#### Objective
Public exports + docs.

#### Why this step (action + reasoning)
1. **What this step does** — barrel-exports `liveText`/`error` (already on the hook return — type re-export), `foldAgentToolCards`, `useAgentToolCards`, `AgentToolCard`, `ToolEnvelopeResolver`; CHANGELOG + changeset + docs note.
2. **Why it is necessary now** — the symbols are unreachable until exported from `theokit/client`.

#### Evidence
`client/index.ts:34-46` exports `useAgentStream` + `UseAgentStreamReturn`.

#### Files to edit
```
packages/theo/src/client/index.ts — export foldAgentToolCards, useAgentToolCards, AgentToolCard, ToolEnvelopeResolver
CHANGELOG.md (root) — [Unreleased] Added entry
.changeset/m5-client-stream.md — NEW: minor bump theokit
docs (best-effort) — note liveText/error + tool cards if a client docs section exists
```

#### Deep file dependency analysis
- Additive barrel exports. `UseAgentStreamReturn` already exported (now carries `liveText`/`error`).

#### Tasks
1. Add barrel exports.
2. CHANGELOG; changeset (`biome format --write` before commit); docs note if a section exists.

#### TDD
```
RED:     (wiring test) — import foldAgentToolCards + useAgentToolCards from theokit/client resolves
GREEN:   barrel exports (this task)
REFACTOR: None expected
VERIFY:  pnpm exec vitest run tests/unit/agent-stream-derivations.test.ts
```

#### Acceptance Criteria
- [ ] Wiring assertion green (import from `theokit/client` resolves the new symbols).
- [ ] CHANGELOG `[Unreleased] Added` entry present `(#M5-1, #M5-2)`.
- [ ] Pass: lint — `pnpm exec biome check packages/theo/src/client/index.ts` reports 0 warnings.

#### DoD
- [ ] New exports resolve from `theokit/client`; barrel wiring test green
- [ ] CHANGELOG + changeset present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | M5-1 `liveText` derived | T1.1 | useMemo concat (D1) |
| 2 | M5-1 `error` derived | T1.1 | useMemo error event (D1) |
| 3 | M5-2 `foldAgentToolCards` correlator | T1.2 | pure reducer (D2/D3) |
| 4 | M5-2 `useAgentToolCards` hook | T1.2 | hook over fold (D2) |
| 5 | Injectable envelope resolver | T1.2 | `resolveEnvelope` option (D3) |
| 6 | Barrel export (`theokit/client`) | T2.1 | additive exports |
| 7 | Docs + CHANGELOG + changeset | T2.1 | additive |

**Coverage: 7/7 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm exec vitest run tests/unit/agent-stream-derivations.test.ts` green
- [ ] Zero type errors — repo typecheck exits 0
- [ ] Zero lint warnings — `pnpm exec biome check` clean on changed files
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved — existing `useAgentStream` fields/behavior unchanged
- [ ] Plan-specific: `theokit/client` resolves `liveText`/`error`/`foldAgentToolCards`/`useAgentToolCards`
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the derivations in the built client.

### Execution
```
pnpm exec vitest run tests/unit/agent-stream-derivations.test.ts
pnpm exec biome check packages/theo/src/client
# repo typecheck + build
pnpm -w build  (or the theo package build)
```

### Acceptance Criteria
- [ ] All test suites green — `pnpm exec vitest run tests/unit/agent-stream-derivations.test.ts` exits 0
- [ ] Coverage ≥ 90% on changed files (`agent-tool-cards.ts` — critical paths 100%)
- [ ] Zero type/lint errors — repo typecheck + `pnpm exec biome check packages/theo/src/client` each exit 0
- [ ] No regression — `pnpm exec vitest run` reports the theo test suite passing

### If Validation Fails
1. Separate plan-caused from pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
