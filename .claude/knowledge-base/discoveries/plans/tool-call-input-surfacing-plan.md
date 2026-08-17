# Discovery Plan: Tool-call input surfacing (theokit#58)

> **Version 1.1** (edge-cases absorbed: ADR D4 + 2 checkpoints from `reviews/tool-call-input-surfacing-edge-cases-2026-06-30.md`) — Investigate how reference coding-agent frameworks (opencode, codex) assemble a tool call's incrementally-streamed arguments and surface the *complete* input to their UI, and pin down the exact `@theokit/sdk` stream-update shape that carries committed tool-call args. The blueprint must let us decide the correct emit strategy for `@theokit/agents`' `event-translator.ts` so the surfaced `tool_call` StreamEvent carries a populated `input` (today `{}`), without duplicating the running-card (#42) or regressing chronological order.

**Slug:** `tool-call-input-surfacing`
**Owner:** paulo (usetheodev)
**Created:** 2026-06-30
**Time budget:** 3h (per-project breakdown in ADR D1)

## Context

theokit#58: `@theokit/agents` emits the `tool_call` StreamEvent with an EMPTY `input`/`args` (`{}`). Live evidence (theocode UI, Node 24, `theokit@0.11.6`): the `SHELL_EXEC` tool card renders blank — the command the agent ran is never shown — even though the tool executes correctly (args reach the runtime). The raw SSE event is `{"type":"tool_call","name":"shell_exec","args":{},"id":"…"}`.

Root site: `packages/agents/src/bridge/event-translator.ts`:
- line 108 (`status === 'running'`): `input: msg.input ?? msg.arguments ?? {}`
- line 186 (`tool-call-started`): `input: update.toolCall.args ?? {}`
- line 171: `partial-tool-call` (incremental args) is **intentionally ignored**.

The `@theokit/sdk` update union (`node_modules/@theokit/sdk/dist/types/updates.d.ts:148`) declares `ToolCallStartedUpdate` ("args committed" — `:41-45`), `PartialToolCallUpdate` ("arguments streaming in incrementally" — `:52-56`), `ToolCallCompletedUpdate` (`:67`). The contradiction between "args committed at started" and the empty surfaced `input` is the crux: likely a field-path mismatch (`update.toolCall.args` vs the real `ToolCallStartedUpdate` shape) and/or the wrong update variant being read. This discovery resolves *where* the committed args actually live and *how* peers assemble incremental args, so the fix is grounded, not guessed.

This plan complies with `rules/architecture.md` (bridge is the only SDK→event adapter; `G8 — Web Standards`), `rules/testing.md` (every fix starts with a failing regression test; cover edge + negative cases), and `rules/system-design-guardrails.md` G2 (SDK is the only runtime — the fix is pure bridge mapping, no new LLM/tool runtime).

## Objective

Decide the correct, minimal emit strategy for `@theokit/agents` so the `tool_call` StreamEvent's `input` is populated from the SDK's committed/assembled tool-call args. Success criteria:

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/` (opencode, codex) and to the in-repo `@theokit/sdk` update types
- [ ] Cross-cutting comparison table populated for opencode + codex (incremental-args assembly + UI surfacing strategy)
- [ ] Recommendations: at least one concrete emit-strategy proposal (field-path fix vs buffer-partials vs emit-on-completed) with a stated trade-off against #42 (running card) and chronological order
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/opencode/` | `packages/llm/src/protocols/utils/`, `packages/llm/test/`, `packages/app/src/context/global-sync/` | opencode is a production coding agent with incremental tool-arg streaming + a UI that shows the running tool with its args — the closest analog to theocode's tool card |
| `.claude/knowledge-base/references/codex/` | `codex-rs/app-server-protocol/schema/typescript/`, `sdk/typescript/src/` | codex's app-server protocol models function-call args + deltas explicitly; a second independent reference for the assemble-then-surface pattern |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/opencode/**` outside the 3 in-scope dirs | Keeps the dive on the tool-arg-streaming seam; the rest is unrelated (auth, storage, TUI theming) |
| `.claude/knowledge-base/references/codex/codex-rs/**` Rust core (non-schema) | The TS schema + SDK is the surfacing contract we compare against; the Rust executor internals are out of scope |
| `.claude/knowledge-base/references/{astro,fastify,hono,nitro,next.js,workers-sdk,nemo-guardrails,openguardrails-agentfw}/` | Not coding agents / no streaming tool-call-args→UI surface |
| Any project NOT under `.claude/knowledge-base/references/` | Cross-Project Rule: never claim a feature without reading its cloned source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** opencode: 1.5h, codex: 1h, in-repo SDK-shape confirmation: 0.5h.

**Rationale:** opencode is the closest analog (TS, incremental args, UI card with args) → deepest dive. codex is a second independent confirmation of the assemble-then-surface pattern. The in-repo SDK `updates.d.ts` read is bounded — it's a single typed file confirming which field carries committed args.

**Alternatives considered:** equal split (rejected — opencode is the load-bearing reference); single-project (rejected — the golden rule needs ≥2 independent references).

**Stop condition — per question:** when Fase A returns empty after 3 query-variant retries, mark the question BLOCKED with reason "Fase A exhausted"; continue. NEVER fabricate Fase B answers (Unbreakable Rule 3).

**Stop condition — per project:** when budget is exhausted with questions pending, mark them BLOCKED with reason "budget exhausted"; if every remaining question is `done` or honestly `blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` (never `BLUEPRINT_COMPLETE` from a blocked state).

**Consequences:** the halt-loop stops per-project on budget; blocked questions surface in the blueprint as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read the SDK `updates.d.ts` end-to-end (it is the contract). For opencode/codex, Fase A (Grep/ast-grep) to map the arg-assembly hotspots, then Fase B (Read) on each hotspot — capture the assembly data structure (buffer keyed by call id) + the emit point (on-delta vs on-complete).

**Rationale:** the fix decision hinges on *when* peers consider args "complete enough" to show — that intent lives in code + comments, requiring a deep Read, not a symbol grep.

**Consequences:** trade-off — deep reads cost budget; mitigated by the tight in-scope dir list.

### D3 — No new dependency (scope guard)

**Decision:** the investigation assumes the fix is pure bridge logic over the existing `@theokit/sdk` update stream (no new runtime dep), per `rules/system-design-guardrails.md` G2/G11. Q7 validates this assumption rather than presupposing it.

**Rationale:** G2 — SDK is the only runtime; surfacing args is a mapping concern. **Alternatives considered:** adding a stream-parsing lib (rejected pre-emptively unless Q7 finds the SDK does not expose assembled args at all).

### D4 — Reference-fidelity boundaries (from edge-cases EC-3/EC-4)

**Decision:** (a) opencode's incremental-args path is treated as a *mechanism* reference (buffer keyed by call id → parse JSON once complete → surface), NOT a provider-wire reference — its anthropic `partial_json` specifics are illustrative, since theocode uses OpenAI/OpenRouter-style `tool_calls`. (b) codex's contribution is the protocol SHAPE (how it models arg deltas vs the final assembled call) read from `codex-rs/app-server-protocol/schema/typescript/` + `sdk/typescript/src/items.ts`; its Rust assembly algorithm is out-of-scope — if a facet of Q5 needs the algorithm, mark it BLOCKED rather than diving into Rust.

**Rationale:** keeps the dive transferable to theokit's provider mix and respects the Out-of-Scope table. **Consequences:** the blueprint compares strategies at the right altitude (mechanism + protocol shape), not provider trivia.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — map) | Fase B (deep — Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Which `@theokit/sdk` update variant carries the COMPLETE tool-call args, under which exact field path, and in what order are `ToolCallStartedUpdate` / `PartialToolCallUpdate` / `ToolCallCompletedUpdate` emitted? | techniques | (in-repo SDK types) | Grep `ToolCallStartedUpdate\|PartialToolCallUpdate\|ToolCallCompletedUpdate\|args\|delta` in `node_modules/@theokit/sdk/dist/types/updates.d.ts` | Read `node_modules/@theokit/sdk/dist/types/updates.d.ts:1-150` end-to-end; capture each variant's fields + the doc-comments on arg commitment | Table: variant → field carrying args → "committed?" → emit order, with `updates.d.ts:line` per row |
| Q2 | How does opencode assemble incrementally-streamed tool-call arguments (partial_json deltas) into complete args AND surface them to the UI state — buffer→parse→card, show-card-then-fill vs emit-on-complete? | techniques | opencode | `grep -n "partial\|delta\|args\|arguments\|input\|JSON.parse\|accumulat" .claude/knowledge-base/references/opencode/packages/llm/src/protocols/utils/tool-stream.ts` AND `grep -n "tool\|args\|input\|state\|part\|running\|completed" .claude/knowledge-base/references/opencode/packages/app/src/context/global-sync/event-reducer.ts` | Read `tool-stream.ts` fully (buffer data structure keyed by call id + parse/complete point) THEN the tool-call branch of `event-reducer.ts` (is the card created early and patched with args, or created once args are complete?) | Prose + data-structure sketch + early-card-patch-vs-late-card decision + `tool-stream.ts:line` and `event-reducer.ts:line` citations |
| Q4 | How does opencode TEST incremental tool-arg assembly (fixtures, asserted final args)? | tests | opencode | `grep -n "args\|partial\|delta\|expect\|toEqual" .claude/knowledge-base/references/opencode/packages/llm/test/tool-stream.test.ts` | Read the test cases; capture the chunk-split fixtures + the asserted assembled args | Table: test name → input chunks → asserted args, with `tool-stream.test.ts:line` |
| Q5 | How does codex model streaming function-call arguments + the final assembled call in its app-server/SDK protocol (independent confirmation)? | techniques | codex | `grep -n "arguments\|delta\|function_call\|FunctionCall\|partial" .claude/knowledge-base/references/codex/codex-rs/app-server-protocol/schema/typescript/v2/AgentMessageDeltaNotification.ts .claude/knowledge-base/references/codex/codex-rs/app-server-protocol/schema/typescript/ResponseItem.ts` | Read the function-call schema + delta notification + `.../sdk/typescript/src/items.ts`; capture how the final args are represented vs the deltas | Comparison note (codex vs opencode strategy) + `:line` citations |
| Q6 | What is the in-repo test + build harness for `@theokit/agents` bridge mapping (command, runner, existing event-translator test to extend as the regression baseline)? | tools | (in-repo) | `grep -n "test\|vitest" packages/agents/package.json`; locate `packages/agents/tests/unit/event-translator.test.ts` | Read the existing `event-translator.test.ts` tool_call cases + the package test script | Test command + path of the baseline test + which cases assert tool_call mapping |
| Q7 | Does surfacing complete args require any new dependency, or is it pure bridge mapping over the existing SDK update stream? Which `@theokit/sdk` peer floor provides the variants? | deps | (in-repo) | `grep -n "@theokit/sdk" packages/agents/package.json`; cross-ref Q1's variants vs the resolved SDK version | Read `packages/agents/package.json` deps/peerDeps + confirm the variants exist in the resolved `updates.d.ts` | Verdict: new dep needed? (expected: no) + the peer floor that ships the variants |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q7 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q5 | Covered |

**Coverage: 4/4 corners covered (100%)**

> Techniques carries exactly 3 questions: Q1 (in-repo SDK contract), Q2 (opencode assemble + surface — one investigation), Q5 (codex protocol shape). Within the ≤3-per-corner budget.

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | every `.claude/knowledge-base/references/{project}/{path}` (and the SDK `updates.d.ts`) declared in Fase A exists | Mark Qx BLOCKED "path not found"; continue |
| Per-question Fase A budget | Fase A returned ≥1 hotspot OR 3 query-variant retries attempted | After 3 retries empty, mark Qx BLOCKED "Fase A exhausted"; continue |
| After answering Qx | blueprint section under Qx has ≥1 citation | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | total reference/SDK citations ≥ 1 per 200 words of prose | Add citations to under-cited paragraphs (1 retry max) |
| Per-project time budget | budget not exhausted | When exhausted, mark remaining Qx BLOCKED "budget exhausted"; advance |
| Q1 SDK-version record (EC-1) | Q1's answer records the exact resolved SDK version (`readlink -f node_modules/@theokit/sdk`) AND asserts the 3 update variants exist in THAT `updates.d.ts`; if resolved < agents peer floor (`>=2.11.2`), also read the peer-floor version and note any field-path delta | Record version delta as a blueprint caveat; do not answer Q1 from an unverified version |
| Q7 after Q1 (EC-2) | Q1 is `done` (variant + committed-args field named) before Q7 starts | Answer Q1 first; Q7 is undefined until then |
| Before promising complete | all 4 corners have populated sections AND Q1 (SDK field path) is answered with a concrete field name | Refuse promise; continue iterating |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] Q1 yields the concrete field path that carries committed args (the decisive fact for the fix)
- [ ] opencode + codex strategies compared in a cross-cutting table (early-card-patch vs late-card; buffer keyed by call id vs final-only)
- [ ] Recommendation states the emit strategy for `event-translator.ts` + trade-off vs #42 running card + chronological order
- [ ] Every citation backed by a real `.claude/knowledge-base/references/` path or the SDK `updates.d.ts`
- [ ] Blueprint has ≥1 ADR + all four Coverage Corner sections populated

## Global Definition of Done

- `/discover-edge-cases tool-call-input-surfacing` run; MUST-FIX items absorbed (plan → v1.1)
- `/discover-plan-confidence tool-call-input-surfacing` ≥ SHIPPABLE (no fabricated citations; coverage corners non-empty; ≤15 questions)
- `/discover-execute` produces `knowledge-base/discoveries/blueprints/tool-call-input-surfacing-blueprint.md`
- `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- Thresholds + golden rule: `rules/discover-blueprint-golden-rule.md`, `rules/discover-plan-golden-rule.md`
