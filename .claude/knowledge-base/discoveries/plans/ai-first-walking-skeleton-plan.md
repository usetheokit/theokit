# Discovery Plan: AI-First Walking Skeleton (M0 — UIMessageStream ↔ bridge)

> **Version 1.1** (edge-cases EC-1..EC-6 absorbed 2026-07-03) — Investigates how the Vercel AI SDK defines/serializes the **UIMessageStream** protocol (`message.parts`) and how `@ai-sdk/react`'s `useChat` consumes it by convention, in order to map the thinnest end-to-end slice: translate a `@theokit/sdk` `run.stream()` SDKMessage (text only) into a `UIMessageStream` SSE response that `useChat` renders **without a custom adapter**. In scope: `references/ai-sdk` (protocol producer) and `references/assistant-ui` (protocol consumer). Blueprint output: a decision-grade map (chunk sequence, wire headers, dep versions, translation point in the theokit bridge, test shape) for M0 of the `theokit-ai-first` roadmap.

**Slug:** `ai-first-walking-skeleton`
**Owner:** paulohenriquevn
**Created:** 2026-07-03
**Time budget:** 5h (per-project breakdown in ADR D1)

## Context

M0 of `ROADMAP.md` (`theokit-ai-first`) is the walking skeleton: one agent file emitting `UIMessageStream` (text only) consumed by `useChat`, one provider, one endpoint. Today the theokit agent path emits a **proprietary** `AgentEvent` SSE (`packages/theo/src/server/define/define-agent-endpoint.ts:90-91` `data: ${JSON.stringify(event)}\n\n`) with no `x-vercel-ai-ui-message-stream: v1` header and no `[DONE]` terminal marker — so `useChat` cannot consume it. Neither `ai` nor `@ai-sdk/react` is a dependency today (grep across `packages/*/package.json` and root returned none). This discovery closes the gap: exactly which chunk sequence + headers + dep versions + bridge translation point make `useChat` render theokit agent text with zero custom adapter.

Locked constraints this discovery must respect: `rules/architecture.md` (the `bridge` is the only SDK→event adapter), `rules/sdk-runtime.md` + `rules/system-design-guardrails.md` G2 (`@theokit/sdk` is the only runtime — pure mapping, no parallel runtime), `rules/testing.md` (RED regression test before any translator code; cover edge + negative cases), and the ROADMAP M1 protocol-ADR note (UIMessageStream vs AG-UI is decided later; M0 only proves the text slice).

## Objective

The produced blueprint should let us decide **exactly how to emit a `useChat`-consumable text stream from a theokit agent** — the chunk sequence, the wire contract, the dep versions to pin, and the single bridge point to translate at.

Measurable success criteria for the blueprint:

- [ ] All research questions in this plan answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for both in-scope reference projects (ai-sdk producer vs assistant-ui consumer)
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/ai-sdk/` | `packages/ai/src/ui/`, `packages/ai/src/ui-message-stream/`, `packages/ai/src/generate-text/`, `packages/react/src/`, `packages/provider-utils/src/`, `packages/ai/package.json`, `packages/react/package.json` | Protocol producer — the UIMessageStream types, chunk schema, SSE wire format, and `useChat` transport |
| `.claude/knowledge-base/references/assistant-ui/` | `packages/react-ai-sdk/src/ui/`, `packages/react-data-stream/src/`, `packages/react-ai-sdk/package.json` | Protocol consumer — proves what a real UI expects from the stream + which `@ai-sdk` versions it pins |
| (own repo — investigation target, not a reference) | `packages/agents/src/bridge/`, `packages/theo/src/server/define/`, `packages/theo/src/server/agent/`, `packages/agents/tests/unit/` | The bridge point to translate at + the existing test shape to mirror |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/ai-sdk/packages/{rsc,svelte,vue,angular,tui,harness*,mcp,workflow}/` | Not the React `useChat` path; RSC/terminal deferred to M4/M5; MCP/workflow out of M0 |
| `.claude/knowledge-base/references/ai-sdk/packages/{openai,anthropic,google,...provider dirs}/` | Provider abstraction is the SDK's job (out of scope per ROADMAP) |
| `.claude/knowledge-base/references/*/dist/`, `build/`, `node_modules/` | Build artifacts — cite `src/` |
| Tool-call / reasoning / file / source parts | M0 is **text only**; other part types belong to M1 (Eixo A completo) |
| Any project NOT cloned into `.claude/knowledge-base/references/` | Cross-Project Rule: never claim a feature without reading source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** ai-sdk: 3h, assistant-ui: 1h, own-repo bridge cross-read: 1h.

**Rationale:** ai-sdk is the protocol source of truth (deepest dive — chunk schema + transport + wire format). assistant-ui is corroboration of the consumer contract (1h — confirm `message.parts` shape + pinned versions). The own-repo bridge is already mapped by the Phase-D exploration (citations in hand) — 1h to confirm the translation point + test shape.

**Alternatives considered:** equal split (rejected — ai-sdk carries most of the answer); single-project (rejected — must corroborate producer against a real consumer to avoid a wrong wire assumption).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants (pattern → kind-based → alternate path → broader scope), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots.

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with N questions pending, mark them BLOCKED with reason "budget exhausted" and continue. If every remaining project is `done`-or-`blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` with the honest report — never `BLUEPRINT_COMPLETE` from a blocked state.

**Anti-pattern:** NEVER fabricate Fase B answers to close a Fase-A-exhausted question (Unbreakable Rule 3).

**Consequences:** the halt-loop stops per-project on budget exhaustion; blocked questions surface in the blueprint's `## Blocked questions` section as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read the ai-sdk `ui-message-stream/` and `ui/` files end-to-end (the chunk schema + transport are small and load-bearing); Grep/Read spot-checks for assistant-ui (consumer confirmation only); rely on the already-collected Phase-D citations for the own-repo bridge (confirm, don't re-map).

**Rationale:** the chunk sequence for text streaming is the crux of M0 — getting it wrong fails `useChat` silently; it warrants full reads. assistant-ui only needs to confirm the parts contract.

**Consequences:** deep on the protocol, shallow on the consumer — trade-off accepted because the producer contract is what the theokit bridge must emit exactly.

### D3 — Version-conflict resolution is a required output

**Decision:** The blueprint MUST resolve which `ai` + `@ai-sdk/react` versions to pin, given the clone shows `ai@7.0.14` / `@ai-sdk/react@4.0.15` while assistant-ui pins `ai@^6.0.209` / `@ai-sdk/react@^3.0.211`.

**Rationale:** M0 depends on `@ai-sdk/react` `useChat`; a wrong/unstable version breaks the whole slice. This is the one dependency decision M0 cannot defer.

**Consequences:** Q4 must cross-check the clone versions against the npm-published stable line before `/deps-audit` runs in the plan phase.

**EC-1 (MUST FIX — version↔protocol skew):** the pinned `@ai-sdk/react` version MUST be the same major line whose chunk schema (Q1) + wire headers (Q3) were read. If the npm-stable published line differs from the `references/ai-sdk` clone (`ai@7.0.14`/`@ai-sdk/react@4.0.15` are likely internal workspace numbers), Q1/Q3 MUST be re-read against the pinned version's published types before the blueprint records the chunk sequence. Studying one version and shipping another is the primary M0 silent-failure mode.

### D4 — Question order + test-determinism split (EC-2, EC-5, EC-6)

**Decision:** (a) Answer order is **Q1 → Q3 → Q4 → Q2 → Q7**. (b) Q7's CI gate is a **deterministic** integration test built on a fixed `@theokit/sdk` SDKMessage fixture (mocked `run.stream()`); the DoD's "real provider" clause is satisfied by a **separate manual smoke** recorded as evidence, never a live-LLM CI dependency (`testing.md` §3 determinism). (c) assistant-ui is conceptual corroboration of the `message.parts` contract only — it pins a different `@ai-sdk/react` major (`^3`) than the clone, so it is NOT a byte-exact wire reference for the pinned version.

**Rationale:** EC-2/EC-5/EC-6 from the edge-case review — prevent a flaky "green", an out-of-order investigation, and a cross-version wire assumption.

**Consequences:** the blueprint's test recommendation is a deterministic fixture test + a documented smoke; the halt-loop respects the answer order Q1→Q3→Q4→Q2→Q7.

## Research Questions

Each question maps to one Coverage Corner. Fase A = broad locate (grep/ast-grep or Glob for text-shape); Fase B = deep Read at each hotspot. All cited paths were confirmed to exist during the Phase-D exploration.

| # | Question | Corner | Reference project(s) | Fase A (broad map) | Fase B (deep Read at hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | What is the exact ordered sequence of `UIMessageChunk`s `useChat` needs to render pure streaming **text** (start → text-start → text-delta* → text-end → finish), and each chunk's required fields (id, delta)? | techniques | `.claude/knowledge-base/references/ai-sdk/` | Read `packages/ai/src/ui-message-stream/ui-message-chunks.ts:226-398` (chunk union) + Grep `text-start|text-delta|text-end` in `packages/ai/src/ui-message-stream/` | Read `to-ui-message-stream.ts:18-91` to see how a text stream is chunked; read `ui-message-chunks.ts:23-215` (Zod schema) for required fields | Ordered chunk list + per-chunk required fields + `references/ai-sdk/...:line` per chunk |
| Q2 | Where in the theokit `bridge` is the correct single point to translate a `@theokit/sdk` text SDKMessage → `UIMessageChunk`s, without a parallel runtime (architecture.md / sdk-runtime.md)? | techniques | own repo (`packages/agents/src/bridge/`) | Read `packages/agents/src/bridge/event-translator.ts:153-169` (`translateSdkEvent` dispatch) + `agent-stream-events.ts:149-165` (union incl. `TextDeltaEvent`) + `sdk-adapter.ts:307-342` (`mergeDeltaStream`) | Read the `assistant`/text branch of `translateSdkEvent` + `TextDeltaEvent` producer to decide: new translator fn vs extend existing | Named translation point (file:fn) + SDK-field→chunk map + "new fn vs extend" recommendation |
| Q3 | What exact HTTP contract does `DefaultChatTransport` require to parse the stream (response header `x-vercel-ai-ui-message-stream: v1`, `content-type: text/event-stream`, `data:{json}\n\n` framing, `[DONE]` terminal)? | techniques | `.claude/knowledge-base/references/ai-sdk/` | Read `packages/ai/src/ui-message-stream/ui-message-stream-headers.ts:1-7` + `json-to-sse-transform-stream.ts:1-17` | Read `packages/ai/src/ui/default-chat-transport.ts:1-36` + `provider-utils/src/parse-json-event-stream.ts:11-33` to confirm what the client requires vs ignores | Header list + framing rule + terminal-marker rule + citations |
| Q4 | Which `ai` + `@ai-sdk/react` versions to pin? (clone: `ai@7.0.14`/`@ai-sdk/react@4.0.15`; assistant-ui: `ai@^6`/`@ai-sdk/react@^3`) — which is the stable published line? | deps | `.claude/knowledge-base/references/ai-sdk/`, `.claude/knowledge-base/references/assistant-ui/` | Read `references/ai-sdk/packages/ai/package.json` + `packages/react/package.json` (name+version) + `references/assistant-ui/packages/react-ai-sdk/package.json:54-60` | Cross-check against the npm-published stable `ai` / `@ai-sdk/react` line (WebFetch npm registry, allowlisted) | Pinned version range for `ai` + `@ai-sdk/react` + justification + citations |
| Q5 | How does the ai-sdk test the UI message stream / chunk parsing — what fixture + assertion shape should our integration test mirror? | tests | `.claude/knowledge-base/references/ai-sdk/` | Grep `*.test.ts` in `packages/ai/src/ui-message-stream/` and `packages/react/src/` for `toUIMessageStream`/`useChat` | Read 1–2 representative test files to capture the fixture + assertion pattern | Test-pattern summary (fixture shape + assertion style) + citations |
| Q6 | How is the theokit `event-translator` unit-tested today, so the new UIMessageStream translator's RED test mirrors it (testing.md — RED before GREEN)? | tests | own repo | Read `packages/agents/tests/unit/event-translator.test.ts:22-122` (SDK message fixtures + assertions) | Read the assistant/text-message test case to derive the RED shape for the new translator | RED-test skeleton (given SDK text msg → expect chunk sequence) + citation |
| Q7 | Where should the M0 walking skeleton live (example vs fixture) and how is a theokit agent endpoint + client wired today, to place a green integration/E2E test? | tools | own repo | Read `packages/theo/src/server/define/define-agent-endpoint.ts:84-268` (SSE headers + Response builder) + Glob `examples/`, `fixtures/` for an agent example | Read `packages/theo/src/client/use-agent-stream.ts:54-64` (current client shape) + the closest example to pick the skeleton's home + test command | Skeleton location + endpoint-wiring steps + **(EC-2)** TWO test artifacts: a deterministic integration test (SDKMessage fixture, mocked `run.stream()`) as the CI gate + a separate real-provider smoke recorded as DoD evidence |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q5, Q6 | Covered |
| Dependencies | Q4 | Covered |
| Tools | Q7 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Every `.claude/knowledge-base/references/{project}/{path}` declared for Qx exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥ 1 hotspot OR 3 query-variant retries attempted | After 3 retries empty, mark Qx BLOCKED "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has ≥ 1 citation | Re-iterate Qx (1 retry max) |
| Q1/Q3 correctness | The chunk sequence + headers are cited from `ui-message-chunks.ts` / `ui-message-stream-headers.ts` (not inferred) | Re-read the file; no inference allowed |
| Q4 version decision | A concrete pinned range is chosen AND justified against the published line | Mark Q4 BLOCKED "version unresolved" — blocks M0 deps-audit |
| Q1 frame chunks (EC-3) | The answer lists message-frame chunks (`start`, `finish`) + the message `id` field, not only `text-start/delta/end` | Re-read `ui-message-chunks.ts`; a text-only chunk list may render nothing in `useChat` |
| Q2 text branch (EC-4) | Q2 determines whether live text flows via `translateInteractionUpdate` (onDelta `text-delta`) or `translateSdkEvent` (run.stream `assistant`), AND whether `mergeDeltaStream` dedup would drop/dup a UIMessageStream emission | Re-read the branch; translate where text actually flows, no dedup carve-out |
| Answer order (EC-5) | Questions answered in order Q1→Q3→Q4→Q2→Q7 (later ones depend on earlier shape/version) | Re-order; do not answer Q7 before Q1/Q3/Q4 |
| Per-project time budget | Budget not exhausted | When exhausted, mark remaining Qx BLOCKED "budget exhausted"; advance |
| Before promising complete | All 4 coverage corners have populated sections | Refuse promise, continue iterating |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/references/{...}` path (or a real own-repo `packages/...` path for the bridge/test questions)
- [ ] At least one ADR section in the blueprint synthesizes decisions taken (chunk sequence, wire contract, translation point, pinned versions)
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/ai-first-walking-skeleton-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → plan-confidence → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one project rule: `architecture.md` (bridge is the only SDK→event adapter), `sdk-runtime.md` (SDK is the only runtime — KISS/YAGNI: no parallel runtime), `testing.md` (RED before GREEN, edge + negative cases)
