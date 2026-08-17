# Plan: Tool-Dialect Tag Stripper — neutralize leaked Hermes `<function=…>` in assistant text

> **Version 1.1** — absorbed 4 SHOULD-TEST items + 1 DOCUMENT note from `reviews/tool-dialect-tag-stripper-edge-cases-2026-06-30.md` (EC-1 non-string `text_delta` guard, EC-2 error-flush try/finally, EC-3 adjacent leaks, EC-4 cross-event straddle, EC-5 within-leak embedded-close collision note). 0 MUST FIX.
>
> **Version 1.0** — Fix theocode#32 framework-first in `@theokit/agents`: `qwen/qwen3-coder` intermittently leaks its Hermes tool-call dialect (`<function=name><parameter=k>v</parameter></function></tool_call>` XML) into the assistant TEXT stream as `text_delta` instead of native `tool_calls`, rendering raw XML in the visible answer. Add an opt-in stream transform that STRIPS the leaked block out of the text channel (never re-parses it), mirroring the existing `think-tag-extractor.ts` pattern. theocode adopts to close #32.

## Goal

> Enable `@theokit/agents` consumers to strip a model's leaked Hermes `<function=…></tool_call>` tool-call dialect from the visible assistant text via an opt-in `stripToolDialect` flag, so leaked XML never renders as the answer, measured by `tool-dialect-stripper.test.ts` + `sdk-adapter-tool-dialect.test.ts` passing (stripped when enabled, byte-identical passthrough when disabled).

## Context

theocode#32 (live-reproduced via MCP, 2026-06-30): on the OpenRouter path, `qwen/qwen3-coder-30b-a3b-instruct` used native `tool_calls` in round 1 but in round 2 emitted its tool-call dialect as assistant CONTENT — `<function=write_file><parameter=path>…</parameter></function></tool_call>` — which the OpenAI-compatible path forwards verbatim as `text_delta`, so raw XML renders in the answer.

The discovery cycle (`tool-dialect-tag-sanitizer` blueprint, SHIPPABLE_WITH_CAVEATS 89) established that `@theokit/agents` ALREADY ships the exact pattern for this model class: `bridge/think-tag-extractor.ts` neutralizes inline `<think>` dialect tags from the assistant text stream, opt-in via `parseThinkTags`, wired into `createSdkAgentStream` (`sdk-adapter.ts:497`). The `<function=…>` leak is the same class (a dialect tag in the text stream from the same qwen/deepseek family). This plan implements the framework-first fix; theocode adopts the bumped package to close #32.

This is a sibling-of-theokit#53: that fix made the no-progress signature key on tool-calls only. PARSING the leaked XML back into a `tool_call` would re-introduce a spin (a re-parsed call the loop would re-run) and trust a channel the provider already broke — hence STRIP, never parse (ADR D1).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/bridge/tool-dialect-stripper.ts` (NEW) | 0 | — | (file to be created — the stripper transform) | — |
| `packages/agents/src/bridge/think-tag-extractor.ts` | 130 | `a7784ac` (2026-06-28) | The precedent: inline-`<think>` extractor + StreamEvent transform | READ-ONLY here — copied as shape reference, NOT modified |
| `packages/agents/src/bridge/sdk-adapter.ts` | 521 | `6830737` (2026-06-29) | Bridges compiled `@Agent` → SDK `Agent.create/send`; owns `createSdkAgentStream` + `RuntimeOverrides` | `parseThinkTags` wiring at `:357`/`:497` must stay byte-identical when new flag off; `mergeDeltaStream` order; exactly-one-terminal-done invariant |
| `packages/agents/src/types.ts` | 93 | `a4f668f` (2026-06-28) | `AgentConfig` — the `@Agent({...})` decorator options type | existing fields (`parseThinkTags:27`) unchanged; additive only |
| `packages/agents/src/bridge/agent-compiler.ts` | 154 | `a4f668f` (2026-06-28) | Compiles walked `@Agent` metadata → `CompiledAgent`; copies `parseThinkTags` at `:139` | `CompiledAgent` shape additive only; copy line mirrors `parseThinkTags` |
| `packages/agents/src/loop/agent-runner.ts` | 307 | `a4f668f` (2026-06-28) | `AgentRunner.stream` options + forwards to `createSdkAgentStream` (`parseThinkTags` at `:81`/`:220`) | forwarding additive only; no change to existing pass-through |
| `packages/agents/tests/unit/tool-dialect-stripper.test.ts` (NEW) | 0 | — | (file to be created — splitter unit tests) | — |
| `packages/agents/tests/integration/sdk-adapter-tool-dialect.test.ts` (NEW) | 0 | — | (file to be created — opt-in wiring tests) | — |
| `CHANGELOG.md` | — | — | Public contract (Unbreakable Rule 6) | append under `[Unreleased]`, never edit released entries |

### Current callers / dependents

- **Symbol:** `createSdkAgentStream(compiled, tools, apiKey, overrides)` in `packages/agents/src/bridge/sdk-adapter.ts:349`
  - **Callers (production):** `packages/agents/src/loop/agent-runner.ts:217` (the sole stream factory call-site)
  - **Callers (tests):** `packages/agents/tests/integration/sdk-adapter-think-tags.test.ts` (via `AgentRunner.stream`), `sdk-adapter-reasoning.test.ts`
  - **External (public API consumed by other repos):** yes — theocode consumes `AgentRunner.stream(...)` with per-run options; the new `stripToolDialect` flows through the same `RuntimeOverrides`/`AgentRunStreamOptions` surface. Additive optional field → backward-compatible.
- **Symbol:** `RuntimeOverrides` interface in `sdk-adapter.ts:84` — extended with `stripToolDialect?: boolean` (mirrors `parseThinkTags:96`).
- **Symbol:** `AgentConfig` in `types.ts` — extended with `stripToolDialect?: boolean` (mirrors `parseThinkTags:27`); read by `agent-compiler.ts`.
- **Symbol:** `CompiledAgent` in `agent-compiler.ts:90` — extended with `stripToolDialect?: boolean`; populated at the copy site mirroring `:139`.
- **Symbol:** `AgentRunStreamOptions` in `agent-runner.ts:76` — extended with `stripToolDialect?: boolean` (mirrors `parseThinkTags:81`); forwarded at `:220`.

### Domain glossary

- **Hermes tool-call dialect** — an XML-ish tool-call encoding (`<function=NAME><parameter=K>V</parameter></function></tool_call>`) some models emit as text instead of native OpenAI `tool_calls` JSON.
- **StreamEvent** — the bridge's normalized stream event union (`text_delta` | `thinking` | `tool_call` | `done` | `error` | `status`), defined in `bridge/agent-sse-handler.ts`.
- **Incremental splitter / held-prefix** — a streaming-correctness technique: emit resolved content but hold back a trailing substring that could still grow into a delimiter on the next chunk (`think-tag-extractor.ts:38` `heldPrefixLength`).
- **Strip vs parse** — STRIP = neutralize the leaked dialect (drop it from visible text); PARSE = reconstruct it into a structured tool call. This plan STRIPS (ADR D1).
- **Opt-in flag** — a default-off boolean the consumer enables per-model; both a compiled `@Agent({...})` field and a per-run override (mirrors `parseThinkTags`).

### Architecture boundaries affected

- `packages/agents` bridge layer only (`rules/architecture.md` § bridge; `system-design-guardrails.md` G1 — agents depends on http/sdk, never the reverse). No new cross-package edge.
- G8 (Web Standards): the transform is a pure async-generator over `StreamEvent`, no Node APIs.
- G10 (Honest Enforcement): the flag actually enforces stripping; default-off documented; never silently render a leaked dialect when enabled.
- New public export surface: `stripToolDialect` added to 4 existing public types (additive). Below G6's 30-export budget — no new barrel export needed (the transform is internal, like `think-tag-extractor`).

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/tool-dialect-tag-sanitizer-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89) — locks D1 (STRIP), D2 (opt-in), D3 (incremental-splitter, no new dep). ADRs below implement its D1/D2/D3 verbatim.
- **In-repo precedent (the authoritative pattern):** `packages/agents/src/bridge/think-tag-extractor.ts` — `createThinkTagExtractor` (incremental splitter + held-prefix buffer, `:38`/`:55`/`:62-93`) + `extractThinkTagStream` (StreamEvent transform over `text_delta`, `:115-130`). Wired opt-in at `sdk-adapter.ts:357`/`:497`. The stripper is a sibling module reusing this exact shape.
- **Reference projects (from the blueprint):** opencode `transform.ts:25` (STRIP-not-parse: malformed content neutralized via `.replace`, never salvaged) + `openai-chat.ts:74`/`:234` (native `tool_calls` is the sole parsed contract; text dialect is out-of-contract); codex `openai_models.rs:265-379` (tools are structured/JSON-schema, never text — the leak is a model deviation).
- **Sibling fix:** theokit#53 (`no-progress-signature-tool-calls-only`, released `@theokit/agents@0.24.1`) — why PARSING the leak is rejected (spin re-introduction).

## Dependencies

> Per ADR D3, this plan adds **ZERO** new dependency. The new module imports only an in-repo TYPE (`StreamEvent`), exactly like the precedent `think-tag-extractor.ts:18`. No registry package is introduced, upgraded, or removed.

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none added/touched) | — | — | The stripper imports only the in-repo `StreamEvent` type from `./agent-sse-handler.js` (a sibling module, not a package). `@theokit/agents` existing peerDeps (`@theokit/sdk`, `@theokit/http`, `zod`, `reflect-metadata`) are unchanged by this plan. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | The need is pure string-splitting over a known delimiter pair; the in-repo `createThinkTagExtractor` already solves the identical streaming-correctness problem. Rule 9 / parsimony-ladder rung 4: reuse the in-repo pattern, add nothing. | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Objective

- [ ] Sub-goal 1 — `createToolDialectStripper()` pure incremental splitter strips a full `<function=…></tool_call>` block from text, preserves surrounding text, handles OPEN/CLOSE straddling chunk boundaries, and flushes an unclosed `<function=` as text on `end()` (lossless).
- [ ] Sub-goal 2 — `stripToolDialectStream(source)` StreamEvent transform applies the stripper to `text_delta` events, passing every other event through unchanged.
- [ ] Sub-goal 3 — `stripToolDialect` flag wired opt-in (default OFF) through `AgentConfig` → `CompiledAgent` → `RuntimeOverrides`/`AgentRunStreamOptions` → `createSdkAgentStream`, mirroring `parseThinkTags`.
- [ ] Sub-goal 4 — flag OFF ⇒ stream byte-identical to today (backward-compat); flag ON ⇒ leaked XML stripped from `text_delta`.

## ADRs

### D1 — STRIP the leaked dialect; never PARSE it into a tool call

**Decision:** The transform strips the `<function=…></tool_call>` block out of the `text_delta` channel (drops it from visible text). It does NOT reconstruct a `tool_call`.

**Rationale:** Blueprint D1 + the references converge: opencode neutralizes out-of-contract content (`transform.ts:25`), never salvages; native `tool_calls` is the sole parsed contract (`openai-chat.ts:74`); codex treats tools as structured, never text (`openai_models.rs:265`). Parsing the leak would re-introduce the theokit#53 spin (a re-parsed call the loop re-runs) and trust a provider-broken channel. (Unbreakable Rule: blueprint-anchored; `system-design-guardrails.md` G10.)

**Alternatives considered:** _PARSE/salvage into a synthetic `tool_call`_ — rejected: spin risk (theokit#53), malformed-args injection, no loop signature guarantee. _Render-time strip in the UI_ — rejected: renderer is out of scope; the leak must die at the stream transform so every consumer (CLI/desktop/logs) benefits.

**Consequences:** Visible answer is clean; a leaked tool intent is dropped (the model simply failed to call the tool that round; the loop continues honestly, no phantom execution). Surfacing the stripped XML as a diagnostic segment is deferred (YAGNI) — not required to close #32.

### D2 — Opt-in via `stripToolDialect` flag (sibling to `parseThinkTags`), default OFF

**Decision:** New flag wired through the same dual path as `parseThinkTags` — a compiled `@Agent({ stripToolDialect })` field AND a per-run `RuntimeOverrides`/stream-options override, resolved `overrides ?? compiled ?? false`. Default OFF.

**Rationale:** Blueprint D2 — a code assistant can legitimately emit a literal `<function=` substring in answer/code text (explaining Hermes format, generating code containing that string). Always-on stripping would corrupt legitimate content. Symmetry with `parseThinkTags` (`sdk-adapter.ts:357`, `types.ts:27`, `agent-compiler.ts:139`, `agent-runner.ts:81/220`) keeps the framework surface coherent (DRY of the wiring pattern, KISS).

**Alternatives considered:** _Always-on_ — rejected: surrogate-pair repair is universal (invalid Unicode never legitimate), but `<function=` CAN be legitimate text, so the two are not analogous. _Auto-enable per-model (qwen allowlist)_ — rejected as premature (YAGNI / G11); the consumer (theocode) knows its model and opts in.

**Consequences:** theocode opts in for the qwen path to close #32; all other consumers unaffected by default. Four additive optional fields + one resolution line + one wiring line, mirroring existing plumbing.

### D3 — Reuse the incremental-splitter shape; add NO dependency

**Decision:** Implement as a `StreamEvent` transform over `text_delta` built on a `createThinkTagExtractor`-style incremental splitter with a held-prefix buffer for chunk-straddle and a lossless `end()` flush. Pure string logic, zero new dependency. The delimiter is a fixed OPEN string `<function=` through a fixed CLOSE string `</tool_call>` (a two-string pair, vs `<think>` single-tag).

**Rationale:** Blueprint D3 — the leak arrives as streaming `text_delta`; a multi-char delimiter can straddle chunk boundaries — exactly what `heldPrefixLength` solves (`think-tag-extractor.ts:38`). opencode's sanitizer is stdlib-only (`transform.ts:25`); the in-repo splitter is zero-dep (`think-tag-extractor.ts:18`). Reuse the proven shape; generalize from single-tag to an OPEN…CLOSE pair (Unbreakable Rule 9 / `parsimony-ladder.md` rung 4 — reuse before adding).

**Alternatives considered:** _Message-array transform (opencode `normalizeMessages` shape)_ — rejected: operates at turn boundary, but the leak must be neutralized incrementally as `text_delta` streams (else raw XML flashes live). _Single regex `.replace` over accumulated text_ — rejected: cannot handle streaming/straddle without buffering the whole turn (defeats streaming UX).

**Consequences:** A new ~100-LoC module, sibling to `think-tag-extractor.ts`; no dependency, no new barrel export.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A truncated leak (stream cut mid-`<function=…>` with no `</tool_call>`) is flushed as text on `end()`, so ugly XML can still render in that rare case | Low | Rule 8 (lose nothing) over silent drop: flushing as text is the honest choice; documented edge case + test `unclosed_function_flushed_as_text` | agents |
| Legitimate `<function=` substring in answer/code text gets held/buffered while scanning for a (never-arriving) `</tool_call>`, delaying its emission until `end()` | Low | Flag is OFF by default; only a consumer that opts in (qwen path) sees buffering; on `end()` the held text is flushed losslessly | agents |
| Wiring drift — the dual compiled+override path has 5 touch-points; missing one yields a silently-inert flag | Medium | Integration test asserts compiled-true, compiled-undefined, and per-run-override-beats-compiled (mirrors `sdk-adapter-think-tags.test.ts:71-99`); G10 honest-enforcement | agents |
| False strip — a model emits `<function=` legitimately AND later an unrelated `</tool_call>` far downstream, stripping a large legit span | Low | Real Hermes leaks pair tightly; the flag is per-model opt-in; documented; the consumer enables it only for models that exhibit the leak | agents |

## Unresolved Questions

- Q1 — Should the OPEN delimiter be the literal `<function=` (Hermes) only, or also cover the bare `<tool_call>` wrapper some models emit? → For #32, `<function=` … `</tool_call>` is the observed shape; broadening to other dialect openers is YAGNI until a second model is observed (single change-point constant, like `think-tag-extractor.ts:21`). Resolved: scope to the observed Hermes pair; constant is a single change-point for a future second opener.
- Q2 — On an unclosed `<function=` at stream end, flush as text (lossless) or drop (assume truncated leak)? → Resolved by D1 consequences + Rule 8: flush as text (never silently drop unconfirmed content). Captured as a MUST test.

## Dependency Graph

```
Phase 1 (stripper core + unit tests) ──▶ Phase 2 (wiring + integration tests) ──▶ Phase 3 (Integration Validation)
```

Sequential: Phase 2 imports the Phase 1 module; Phase 3 validates the whole. No parallelism (single small module + its wiring).

---

## Phase 1: Stripper core (pure incremental splitter)

**Objective:** Ship `createToolDialectStripper` + `stripToolDialectStream` in a new module, fully unit-tested, with no wiring yet.

### T1.1 — `tool-dialect-stripper.ts` (NEW)

#### Objective
Create the pure incremental splitter that strips a `<function=…></tool_call>` block from a text stream, plus the StreamEvent transform over `text_delta`.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does** — introduces `packages/agents/src/bridge/tool-dialect-stripper.ts` exporting `createToolDialectStripper()` (a stateful `write`/`end` splitter) and `stripToolDialectStream(source)` (an async-generator StreamEvent transform), mirroring `think-tag-extractor.ts`.

**Why it is necessary now** — this is the leaf the wiring (T2.x) depends on; it carries all the streaming-correctness logic (chunk-straddle, lossless flush). Building + unit-testing it in isolation first (ADR D3, blueprint D3) means the wiring phase only proves the opt-in plumbing, not the algorithm. Cite `think-tag-extractor.ts:55-130` as the shape.

#### Evidence
- Shape to mirror: `packages/agents/src/bridge/think-tag-extractor.ts:38` (`heldPrefixLength`), `:55-94` (`createThinkTagExtractor`), `:115-130` (`extractThinkTagStream`).
- Delimiter shape from the leak: `.claude/knowledge-base/discoveries/blueprints/tool-dialect-tag-sanitizer-blueprint.md` § "Coverage Corner 4 — Technique 2" (native `tool_calls` is the contract; `<function=…></tool_call>` text is the deviation).
- `StreamEvent` union: `packages/agents/src/bridge/agent-sse-handler.ts` (imported by `think-tag-extractor.ts:18`).

#### Files to edit
```
packages/agents/src/bridge/tool-dialect-stripper.ts — NEW: createToolDialectStripper + stripToolDialectStream
packages/agents/tests/unit/tool-dialect-stripper.test.ts — NEW: RED unit tests (splitter)
```

#### Deep file dependency analysis
- `tool-dialect-stripper.ts` (NEW) imports only `type { StreamEvent }` from `./agent-sse-handler.js` (mirrors `think-tag-extractor.ts:18`) — zero runtime dep (ADR D3).
- No production caller yet (wired in T2.2). Unit test is the sole exerciser this phase.

#### Deep Dives
- **Mode state:** `'text'` (scanning for OPEN `<function=`) vs `'stripping'` (inside a leak, scanning for CLOSE `</tool_call>`, dropping content). Two fixed delimiter strings, NOT a single tag.
- **Lossless invariant (Q2/D1):** content is DROPPED only when a full `OPEN…CLOSE` pair is resolved. A held OPEN-prefix at `end()` (text mode) flushes as text; an unclosed leak at `end()` (stripping mode) flushes the ENTIRE buffered block — including the consumed `<function=` — as text. Never silently drop unconfirmed content (Unbreakable Rule 8, mirroring `think-tag-extractor.ts:86-91`).
- **Held-prefix for both delimiters:** reuse a `heldPrefixLength(s, delim)` helper for OPEN (in text mode) and CLOSE (in stripping mode) so a delimiter split across two chunks is recognized.
- **Multiple leaks:** after resolving one `OPEN…CLOSE`, continue scanning the remainder in text mode (loop), so N leaks in one stream are all stripped — including ADJACENT leaks with no separating text (EC-3).
- **Edge cases:** empty input → no segments; `<function=` with no close → flushed as text on end; CLOSE without OPEN in text mode → plain text (text mode only scans OPEN); text before/between/after leaks → preserved.
- **Within-leak embedded close (EC-5, accepted limit):** if a leaked block's parameter value contains the literal substring `</tool_call>`, the scanner closes at that inner occurrence and the real trailing `</function></tool_call>` renders as text. Best-effort strip — same class as the think-tag scanner being fooled by `<thinkers>`-shaped content. Accepted (very low probability; per-model opt-in; leftover is small, not corruption), NOT mitigated.

#### Pseudo-code / Signatures

```pseudocode
const OPEN = '<function='        -- single change-point (Q1)
const CLOSE = '</tool_call>'
type Segment = { kind: 'text' | 'dropped', content: string }

function createToolDialectStripper():
  mode = 'text'; buffer = ''; pendingLeak = ''   -- pendingLeak holds the dropped-so-far for lossless flush
  write(chunk):
    buffer += chunk; out = []
    loop:
      if mode == 'text':
        idx = buffer.indexOf(OPEN)
        if idx != -1:
          if buffer[0:idx]: out.push({text, buffer[0:idx]})
          pendingLeak = OPEN; buffer = buffer.slice(idx + OPEN.len); mode = 'stripping'; continue
        keep = heldPrefixLength(buffer, OPEN); emit buffer[0:len-keep] as text; buffer = tail(keep); break
      else: -- stripping
        idx = buffer.indexOf(CLOSE)
        if idx != -1:
          -- full leak resolved → drop pendingLeak + buffer[0:idx+CLOSE.len]
          buffer = buffer.slice(idx + CLOSE.len); pendingLeak = ''; mode = 'text'; continue
        keep = heldPrefixLength(buffer, CLOSE)
        pendingLeak += buffer[0:len-keep]; buffer = tail(keep); break   -- accumulate dropped content
    return out  -- only text segments; dropped content is never emitted
  end():
    -- lossless: an unclosed leak flushes pendingLeak + buffer AS TEXT (Rule 8)
    if mode == 'stripping': leftover = pendingLeak + buffer
    else: leftover = buffer
    return leftover ? [{text, leftover}] : []

# Example (flag conceptually ON):
input chunks:  ['ok ', '<function=write><parameter=p>x</parameter></function></tool_call>', ' done']
output text:   'ok ' + ' done'   -- leak stripped, surrounding text preserved
```

#### Tasks
1. Add `tool-dialect-stripper.ts` with `OPEN`/`CLOSE` constants, `heldPrefixLength`, `createToolDialectStripper`, `stripToolDialectStream`.
2. Write the RED unit tests first (see TDD), confirm they fail.
3. Implement the minimal splitter to pass; iterate to green.
4. REFACTOR: factor `heldPrefixLength` identically to the think-tag version (or share if trivially extractable — KISS, do not over-abstract for two callers).

#### TDD

```
RED: test_stripper_passthrough_no_leak() — 'hello world' → one text segment 'hello world'
RED: test_stripper_strips_full_leak() — 'a<function=w><parameter=p>x</parameter></function></tool_call>b' → text 'a' + 'b' (leak dropped)
RED: test_stripper_open_split_across_chunks() — write('a<func') then write('tion=w></tool_call>z') → 'a' … 'z' (OPEN straddles)
RED: test_stripper_close_split_across_chunks() — write('<function=w></tool') then write('_call>end') → only 'end' surfaces
RED: test_stripper_unclosed_function_flushed_as_text() — write('x<function=w>partial'); end() → flushes 'x' + '<function=w>partial' as TEXT (lossless, Rule 8)
RED: test_stripper_close_without_open_stays_text() — 'answer</tool_call>more' → text verbatim (text mode scans only OPEN)
RED: test_stripper_multiple_leaks() — 'a<function=1></tool_call>b<function=2></tool_call>c' → 'a'+'b'+'c'
RED: test_stripper_adjacent_leaks() — '<function=1></tool_call><function=2></tool_call>tail' → only 'tail' (EC-3: zero-separator, mode resets to text with immediate OPEN at idx 0)
RED: test_stripper_partial_open_prefix_then_mismatch() — 'a<functor>b' (held '<functi…' never completes) → text 'a<functor>b' verbatim, no drop
GREEN: implement createToolDialectStripper + stripToolDialectStream to pass all RED
REFACTOR: align heldPrefixLength with think-tag-extractor.ts:38 shape
VERIFY: pnpm --filter @theokit/agents test -- tool-dialect-stripper
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

(The stripper is a per-stream stateful object; one instance per stream like `createThinkTagExtractor`, no shared mutable state across streams — `think-tag-extractor.ts:55` "never shared". `stripToolDialectStream` is an async-generator with no concurrency primitive.)

#### Acceptance Criteria
- [ ] All 8 RED unit tests pass GREEN — `pnpm --filter @theokit/agents test -- tool-dialect-stripper` reports 8 passed, 0 failed.
- [ ] `stripToolDialectStream` passes non-`text_delta` events through unchanged — asserted by `test_strip_passes_non_string_text_delta_untouched` (green).
- [ ] Pass: lint — `npx eslint packages/agents/src/bridge/tool-dialect-stripper.ts --max-warnings=0` exits 0 with zero warnings.
- [ ] Pass: size — `wc -l packages/agents/src/bridge/tool-dialect-stripper.ts` ≤ 500 lines (expect ~110, sibling of the 130-LoC think-tag module; G6).
- [ ] Pass: types — `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exit 0.

#### DoD (Definition of Done)
- [ ] All tasks completed and validated — `pnpm --filter @theokit/agents test` reports 0 failed.
- [ ] `pnpm --filter @theokit/agents test` green.
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`.
- [ ] Zero lint warnings — `npx eslint packages/agents/ --max-warnings=0`.
- [ ] File-size budget respected — `wc -l` on every changed file ≤ 500 lines (G6 / `architecture.md`).

---

## Phase 2: Opt-in wiring (compiled `@Agent` + per-run override)

**Objective:** Wire `stripToolDialect` through the dual compiled+override path into `createSdkAgentStream`, default OFF, mirroring `parseThinkTags`.

### T2.1 — Thread `stripToolDialect` through the type/compile surface

#### Objective
Add the optional `stripToolDialect?: boolean` field to `AgentConfig`, `CompiledAgent`, `RuntimeOverrides`, and `AgentRunStreamOptions`, with the compiler copy line — all additive, mirroring `parseThinkTags`.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does** — extends 4 existing public types with one optional boolean each, and adds the one-line compiler copy (`stripToolDialect: walkResult.agentConfig.stripToolDialect`) mirroring `agent-compiler.ts:139`.

**Why it is necessary now** — the wiring (T2.2) resolves `overrides.stripToolDialect ?? compiled.stripToolDialect ?? false`; both sides must exist on the types first. Additive optional fields are backward-compatible (existing callers unaffected). Cite the `parseThinkTags` touch-points: `types.ts:27`, `agent-compiler.ts:90-91`/`:139`, `sdk-adapter.ts:96`, `agent-runner.ts:81`/`:220`.

#### Evidence
- `types.ts:22-27` — `parseThinkTags` field on `AgentConfig` (the mirror target).
- `agent-compiler.ts:90-91` (`CompiledAgent.parseThinkTags`) + `:139` (copy from `walkResult.agentConfig`).
- `sdk-adapter.ts:92-96` (`RuntimeOverrides.parseThinkTags`).
- `agent-runner.ts:76-81` (`AgentRunStreamOptions.parseThinkTags`).
- `walk-agent-metadata.ts` carries 0 `parseThinkTags` references → it passes `agentConfig` generically (verified by grep), so NO edit needed there; the new `AgentConfig` field flows through automatically.

#### Files to edit
```
packages/agents/src/types.ts — add stripToolDialect?: boolean to AgentConfig (after parseThinkTags:27), with doc comment
packages/agents/src/bridge/agent-compiler.ts — add stripToolDialect?: boolean to CompiledAgent + copy line mirroring :139
packages/agents/src/bridge/sdk-adapter.ts — add stripToolDialect?: boolean to RuntimeOverrides (after :96)
packages/agents/src/loop/agent-runner.ts — add stripToolDialect?: boolean to AgentRunStreamOptions (after :81) + forward at :220
```

#### Deep file dependency analysis
- `types.ts` `AgentConfig` is the `@Agent({...})` options type; adding a field surfaces it to the decorator declaration. Downstream: `agent-compiler.ts` reads it; `walk-agent-metadata.ts` passes it through generically (no edit).
- `agent-compiler.ts` `CompiledAgent` is consumed by `sdk-adapter.ts:357` (`compiled.parseThinkTags`); the new field is read at the resolution site (T2.2).
- `agent-runner.ts:220` forwards stream options into `createSdkAgentStream`; the new forward line mirrors the `parseThinkTags` forward.

#### Deep Dives
- **Invariant:** all four additions are OPTIONAL (`?:`) → existing `@Agent`/`stream` callers compile unchanged (backward-compat; Baseline "additive only" cells).
- **Doc comments:** mirror the `parseThinkTags` comment tone — name the qwen/deepseek model class + "default false since a code assistant may emit literal `<function=` in text".

#### Pseudo-code / Signatures

```pseudocode
// types.ts (AgentConfig)
/** Opt-in (default false): strip a leaked Hermes `<function=…></tool_call>` tool-call
 *  dialect out of the visible text (theocode#32) — for models (qwen/qwen3-coder) that
 *  leak tool calls as text. Off by default; a code assistant may emit literal `<function=`. */
stripToolDialect?: boolean

// agent-compiler.ts (copy site, mirroring :139)
stripToolDialect: walkResult.agentConfig.stripToolDialect,
```

#### Tasks
1. Add the field + doc comment to `AgentConfig` (`types.ts`).
2. Add the field to `CompiledAgent` + the copy line (`agent-compiler.ts`).
3. Add the field to `RuntimeOverrides` (`sdk-adapter.ts`).
4. Add the field to `AgentRunStreamOptions` + the forward line at the `createSdkAgentStream` call (`agent-runner.ts`).

#### TDD

```
RED: test_agent_config_stripToolDialect_compiles() — @Agent({stripToolDialect:true}) → compileAgent(...).stripToolDialect === true; @Agent without it → undefined (mirror sdk-adapter-think-tags.test.ts:71-73)
GREEN: add the 4 type fields + compiler copy line
REFACTOR: None expected (pure additive)
VERIFY: pnpm --filter @theokit/agents test -- sdk-adapter-tool-dialect
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `compileAgent(walkAgentMetadata(Agent)).stripToolDialect` reflects the `@Agent` flag — asserted by `test_agent_config_stripToolDialect_compiles` (true / undefined).
- [ ] Existing tests unaffected — `pnpm --filter @theokit/agents test` still reports ≥ 486 passed (additive optional fields).
- [ ] Pass: types — `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exit 0.
- [ ] Pass: lint — `npx eslint packages/agents/ --max-warnings=0` exits 0 on the 4 edited files.

#### DoD (Definition of Done)
- [ ] All tasks completed and validated — `pnpm --filter @theokit/agents test` reports 0 failed.
- [ ] `pnpm --filter @theokit/agents test` green.
- [ ] Zero type errors / zero lint warnings.
- [ ] File-size budget respected (no file crosses 500 LoC; `sdk-adapter.ts` 521→~525 — already over 500 historically; see Risk note — additive only, no new function).

### T2.2 — Resolve + wire the transform in `createSdkAgentStream`

#### Objective
Resolve `stripToolDialect = overrides.stripToolDialect ?? compiled.stripToolDialect ?? false` and apply `stripToolDialectStream` to the event stream when true, composing with the existing `parseThinkTags` transform.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does** — adds one resolution line near `sdk-adapter.ts:357` and wraps the stream near `:497` so the events pass through `stripToolDialectStream` when the flag is on, composed with the existing `extractThinkTagStream`.

**Why it is necessary now** — this is the single point where the flag becomes behavior (G10 honest-enforcement). It depends on T1.1 (the transform) and T2.1 (the resolved flag on both types). Cite the `parseThinkTags` wiring at `:357`/`:497` as the exact mirror.

#### Evidence
- `sdk-adapter.ts:357` — `const parseThinkTags = overrides.parseThinkTags ?? compiled.parseThinkTags ?? false`.
- `sdk-adapter.ts:494-497` — `const merged = mergeDeltaStream(...); const events = parseThinkTags ? extractThinkTagStream(merged) : merged`.
- T1.1 — `stripToolDialectStream` (the transform to apply).

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts — add stripToolDialect resolution (near :357) + compose transform (near :497); add import of stripToolDialectStream (near :34)
packages/agents/tests/integration/sdk-adapter-tool-dialect.test.ts — NEW: RED integration tests (opt-in wiring)
```

#### Deep file dependency analysis
- `sdk-adapter.ts` `createSdkAgentStream` is the sole stream factory (called from `agent-runner.ts:217`). The transform composition must preserve the existing `mergeDeltaStream` → (`extractThinkTagStream`?) → yield order. New composition: apply strip AFTER think-tag extraction (or before — order analysis in Deep Dives).
- The integration test drives the fake `send`/`onDelta` exactly like `sdk-adapter-think-tags.test.ts:21-37`.

#### Deep Dives
- **Compose order:** `parseThinkTags` extracts `<think>` → `thinking` events; `stripToolDialect` strips `<function=…>` from `text_delta`. They operate on disjoint markers, so order is behavior-equivalent. Choose: `merged` → `extractThinkTagStream` (if on) → `stripToolDialectStream` (if on) → yield. Apply strip LAST so it operates on the post-think `text_delta` stream (a `<function=` leak never appears inside a `<think>` block in practice; if it did, think extraction would route it to `thinking` and strip would not see it — acceptable, documented).
- **Invariant (backward-compat):** flag OFF ⇒ `events = parseThinkTags ? extractThinkTagStream(merged) : merged` unchanged ⇒ byte-identical to today (`sdk-adapter.ts:497` preserved).
- **Pass-through:** `stripToolDialectStream` yields every non-`text_delta` event unchanged (the `done`/`status`/`tool_call` path, exactly-one-terminal-done invariant preserved).

#### Pseudo-code / Signatures

```pseudocode
// near :357
const stripToolDialect = overrides.stripToolDialect ?? compiled.stripToolDialect ?? false
// near :497
let events = parseThinkTags ? extractThinkTagStream(merged) : merged
if (stripToolDialect) events = stripToolDialectStream(events)
for await (const event of events) yield event

// inside stripToolDialectStream(source) — mirror think-tag-extractor.ts:115-130 EXACTLY:
async function* stripToolDialectStream(source):
  const stripper = createToolDialectStripper()   // ONE instance per stream (cross-event state)
  try:
    for await (event of source):
      if event.type === 'text_delta' && typeof event.content === 'string':   // EC-1 guard
        for (seg of stripper.write(event.content)) yield { type:'text_delta', content: seg.content }
      else:
        yield event                              // non-text_delta + non-string content pass through untouched
  finally:
    for (seg of stripper.end()) yield { type:'text_delta', content: seg.content }   // EC-2: flush on normal end AND on source error
```

#### Tasks
1. Import `stripToolDialectStream` from `./tool-dialect-stripper.js` (near `:34`).
2. Add the resolution line near `:357`.
3. Compose the transform near `:497` (strip applied after think extraction).
4. Write RED integration tests first; confirm fail; then they pass with the wiring.

#### TDD

```
RED: test_stream_strips_dialect_when_enabled() — @Agent({stripToolDialect:true}); onDelta text '<function=w><parameter=p>x</parameter></function></tool_call>answer' → visible text_delta join === 'answer'
RED: test_stream_no_strip_when_disabled() — plain @Agent; same delta → text_delta join CONTAINS the raw '<function=…></tool_call>' (backward-compat passthrough)
RED: test_run_override_stripToolDialect_beats_compiled() — plain compiled + per-run {stripToolDialect:true} → leak stripped (mirror sdk-adapter-think-tags.test.ts:95-99)
RED: test_strip_composes_with_parseThinkTags() — both flags on; delta '<think>r</think><function=w></tool_call>ans' → thinking contains 'r' AND text === 'ans'
RED: test_strip_passes_non_string_text_delta_untouched() — EC-1: a text_delta whose content is non-string is yielded unchanged, never coerced into the buffer (mirror think-tag-extractor.ts:121 guard)
RED: test_strip_flushes_buffer_when_source_errors_midstream() — EC-2: source yields partial '<function=…' then throws → buffered tail flushed as text in finally BEFORE the error re-propagates (mirror think-tag-extractor.ts:127-129); never silently dropped (Rule 8)
RED: test_stream_strips_leak_spanning_two_text_deltas() — EC-4: onDelta('ans <function=w>') then onDelta('</tool_call> more') → visible text === 'ans  more' (ONE stripper instance, cross-event state)
GREEN: add import + resolution + composition (try/finally + non-string guard per pseudocode)
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/agents test -- sdk-adapter-tool-dialect
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

(`createSdkAgentStream` uses async generators + `mergeDeltaStream`; the new code adds no concurrency primitive — it composes a pure transform onto the existing async-iterable, same as `parseThinkTags`.)

#### Acceptance Criteria
- [ ] Flag ON ⇒ leaked `<function=…></tool_call>` stripped from visible `text_delta` — asserted by `test_stream_strips_dialect_when_enabled` (green).
- [ ] Flag OFF ⇒ stream byte-identical (raw XML preserved) — asserted by `test_stream_no_strip_when_disabled` (green; backward-compat).
- [ ] Per-run override beats compiled flag — asserted by `test_run_override_stripToolDialect_beats_compiled` (green).
- [ ] Composes correctly with `parseThinkTags` — asserted by `test_strip_composes_with_parseThinkTags` (both markers handled, green).
- [ ] Pass: types — `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exit 0.
- [ ] Pass: lint — `npx eslint packages/agents/ --max-warnings=0` exits 0 on edited files.

#### DoD (Definition of Done)
- [ ] All tasks completed and validated — `pnpm --filter @theokit/agents test` reports 0 failed.
- [ ] `pnpm --filter @theokit/agents test` green (full suite, ≥ 486 tests + the new ones).
- [ ] Zero type errors / zero lint warnings.
- [ ] CHANGELOG.md updated under `[Unreleased] § Added`.
- [ ] File-size budget respected.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | STRIP leaked `<function=…></tool_call>` from text (D1) | T1.1, T2.2 | splitter drops full leak; wired into stream when flag on |
| 2 | NEVER parse the leak into a tool_call (D1) | T1.1 | splitter only drops/keeps text; no tool_call construction |
| 3 | Opt-in flag, default OFF (D2) | T2.1, T2.2 | `stripToolDialect` dual compiled+override, resolved `?? false` |
| 4 | Reuse incremental-splitter shape, no new dep (D3) | T1.1 | mirrors `think-tag-extractor.ts`; imports only `StreamEvent` type |
| 5 | Chunk-straddle correctness (OPEN + CLOSE) | T1.1 | `heldPrefixLength` for both delimiters; tests for each |
| 6 | Lossless flush of unclosed leak (Q2/Rule 8) | T1.1 | `end()` flushes pendingLeak+buffer as text; dedicated test |
| 7 | Backward-compat: flag OFF byte-identical | T2.2 | resolution defaults false; `:497` composition preserved; passthrough test |
| 8 | Compose with `parseThinkTags` | T2.2 | strip applied after think extraction; combined test |
| 9 | theocode adopts to close #32 | (downstream — separate adoption commit/bump after release) | enable `stripToolDialect` on the qwen agent |
| 10 | EC-1: non-string `text_delta` content not corrupted | T2.2 | `typeof === 'string'` guard + `test_strip_passes_non_string_text_delta_untouched` |
| 11 | EC-2: buffered text not lost on mid-stream source error | T2.2 | try/finally flush + `test_strip_flushes_buffer_when_source_errors_midstream` |
| 12 | EC-3: adjacent leaks (zero separator) both stripped | T1.1 | `test_stripper_adjacent_leaks` |
| 13 | EC-4: leak straddling two `text_delta` events | T2.2 | one-stripper cross-event state + `test_stream_strips_leak_spanning_two_text_deltas` |
| 14 | EC-5: within-leak embedded `</tool_call>` collision | T1.1 (DOCUMENT) | accepted best-effort-scanner limit, noted in Deep Dives |

**Coverage: 14/14 gaps covered (100%)** — gap 9 (theocode adoption) is downstream of the framework release, noted for traceability; gap 14 is an accepted/documented limit.

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — `pnpm --filter @theokit/agents test` green.
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`.
- [ ] Zero lint warnings — `npx eslint packages/agents/ --max-warnings=0`.
- [ ] File-size budget respected (per `architecture.md` / G6).
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6).
- [ ] Backward compatibility preserved — flag OFF ⇒ stream byte-identical (asserted by `test_stream_no_strip_when_disabled`).
- [ ] Plan-specific: `tsup` build green (`pnpm --filter @theokit/agents build`) — DTS exports the new types.
- [ ] **Plan archived** after `/review` READY_TO_MERGE + PR merged.

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```

(The transform is pure in-process string logic over an already-established stream; the SDK owns the LLM I/O. No HTTP/DB/queue/socket touched by this plan.)

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the stripper works end-to-end through `AgentRunner.stream` with the flag both on and off, and that the full agents suite stays green.

### Execution

```
pnpm --filter @theokit/agents test                       # full suite (≥ 486 + new), unit + integration
npx tsc --noEmit -p packages/agents/tsconfig.test.json   # zero type errors
npx eslint packages/agents/ --max-warnings=0             # zero lint warnings
pnpm --filter @theokit/agents build                      # tsup DTS build green (public types export)
```

### Acceptance Criteria

- [ ] All test suites green — `pnpm --filter @theokit/agents test` reports 0 failed (unit + integration).
- [ ] Coverage ≥ 90% on the new `tool-dialect-stripper.ts` (critical paths: 100% — every mode transition + the lossless flush).
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exit 0.
- [ ] Zero lint warnings — `npx eslint packages/agents/ --max-warnings=0` exit 0.
- [ ] Runtime-behavior proof — `test_stream_strips_dialect_when_enabled` observes a leaked-XML input producing clean visible `text_delta` (not just compiles).
- [ ] Failure scenarios green — `(none — no external I/O touched)` declared, so this row is n/a.

### If Validation Fails

1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Pre-existing issues logged in the PR description, do not block.
