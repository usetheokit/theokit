# Discovery Plan: AI-First Canonical Protocol (M1 — all part types + AG-UI ADR)

> **Version 1.1** (edge-cases EC-1..EC-5 absorbed 2026-07-04) — Extends the M0 text-only translator to the FULL `UIMessageStream` part set: map theokit `AgentStreamEvent`s (tool-call, tool-result, reasoning/thinking, error, done) to the ai-sdk tool/reasoning/finish chunks so `useChat` + assistant-ui render a **tool-call card** and reasoning — not just text. Also settles the canonical-protocol ADR: `UIMessageStream` (ai-sdk-native, already adopted in M0) vs AG-UI (CopilotKit, cross-vendor). In scope: `references/ai-sdk` (chunk producer), `references/assistant-ui` (tool-card consumer), `references/copilotkit` (AG-UI contrast). Blueprint output: the exact chunk shapes + `AgentStreamEvent→chunk` mapping + the protocol-choice ADR for M1.

**Slug:** `ai-first-canonical-protocol`
**Owner:** paulohenriquevn
**Created:** 2026-07-04
**Time budget:** 5h (per-project breakdown in ADR D1)

## Context

M1 of `ROADMAP.md` (`theokit-ai-first`), depends on M0 (shipped: `translateToUIMessageStream` handles text + error only — `packages/agents/src/bridge/ui-message-stream-translator.ts:33` explicitly defers tool/reasoning to M1). Today theokit `AgentStreamEvent` already carries `ToolCallEvent`/`ToolResultEvent`/`ThinkingEvent` (`packages/agents/src/bridge/agent-stream-events.ts:14-49`) but the M0 translator drops them (`:56` "Non-text events … produce no [chunk]"). So `useChat` renders an agent's text but shows NOTHING when it calls a tool or reasons. This discovery maps: (a) the exact ai-sdk tool + reasoning chunk shapes, (b) the `AgentStreamEvent → chunk` mapping, (c) what assistant-ui needs to render a tool-call card, and (d) the `UIMessageStream vs AG-UI` decision that M1's protocol ADR must record.

Locked constraints: `rules/architecture.md` (bridge is the only SDK→event adapter), `rules/sdk-runtime.md` + `rules/system-design-guardrails.md` G2 (SDK is the only runtime — pure mapping), `rules/testing.md` (RED before GREEN; edge + negative), and the M0 pinned line (`ai@^7.0.14`, zero skew — reuse).

## Objective

The blueprint should let us decide **exactly how to emit tool-call, tool-result, and reasoning UIMessageChunks from a theokit agent** (chunk shapes + field mapping + ordering) AND **which protocol is canonical** (`UIMessageStream` vs AG-UI).

Measurable success criteria for the blueprint:

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated (ai-sdk chunk shapes ↔ theokit AgentStreamEvent ↔ assistant-ui render contract)
- [ ] Recommendations section provides one concrete decision proposal per research question, INCLUDING the protocol-choice ADR
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/ai-sdk/` | `packages/ai/src/ui-message-stream/` (chunk schema + `to-ui-message-chunk.ts`), `packages/ai/src/ui/ui-messages.ts` (ToolUIPart state machine) | The tool/reasoning/finish chunk shapes + mapping M1 must emit |
| `.claude/knowledge-base/references/assistant-ui/` | `packages/react-ai-sdk/src/ui/utils/convertMessage.ts`, `packages/ui/src/components/assistant-ui/tool-fallback.tsx` | The tool-card + reasoning render contract the M1 E2E must satisfy |
| `.claude/knowledge-base/references/copilotkit/` | `packages/runtime/src/v2/runtime/handlers/shared/sse-response.ts`, `packages/shared/src/finalize-events.ts`, `packages/*/package.json` (`@ag-ui/*`) | AG-UI protocol facts for the `UIMessageStream vs AG-UI` ADR |
| (own repo — investigation target) | `packages/agents/src/bridge/ui-message-stream-translator.ts`, `agent-stream-events.ts`, `packages/agents/tests/unit/ui-message-stream-translator.test.ts` | The M0 base to extend + the AgentStreamEvent variants + the test to mirror |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| Tool APPROVAL / human-in-the-loop chunks (`tool-approval-request/response`, `output-denied`) | HITL is M4 (harness); M1 covers call → result + reasoning, not approval pause |
| `source-url` / `source-document` / `file` / `data-*` parts | Not emitted by theokit AgentStreamEvent; YAGNI for M1 |
| Adopting AG-UI as a second wire (an `@ag-ui/*` adapter) | The ADR DECIDES the protocol; building a second surface is out of M1 (deferred if ever) |
| `.claude/knowledge-base/references/*/dist`, `build`, `node_modules` | Build artifacts — cite `src/` |
| Any project NOT cloned into `.claude/knowledge-base/references/` | Cross-Project Rule |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** ai-sdk: 2h (chunk shapes + mapping — the crux), assistant-ui: 1.5h (tool-card render contract), copilotkit: 1h (AG-UI facts for the ADR), own-repo: 0.5h (confirm the M0 base + AgentStreamEvent variants).

**Rationale:** the tool/reasoning chunk shapes drive the whole implementation; assistant-ui defines the render acceptance bar (the tool-card is a DoD); AG-UI needs only enough fact to write an honest ADR (not to implement).

**Alternatives considered:** equal split (rejected — ai-sdk carries the implementable answer); skip copilotkit (rejected — the ADR must be evidence-based, not hand-waved).

**Stop condition — per question:** 3 empty Fase-A query variants → mark BLOCKED "Fase A exhausted"; continue. Never fabricate (Unbreakable Rule 3).

**Stop condition — per project:** budget exhausted → mark remaining BLOCKED "budget exhausted". If all remaining are done-or-blocked, emit `<promise>BLUEPRINT_BLOCKED</promise>`, never `BLUEPRINT_COMPLETE` from a blocked state.

**Consequences:** the halt-loop stops per-project on budget; blocked questions surface as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read the ai-sdk `ui-message-chunks.ts` tool/reasoning blocks + `to-ui-message-chunk.ts` mapping end-to-end (small, load-bearing); Read assistant-ui `convertMessage.ts` tool/reasoning branches + the tool-fallback component; Grep/Read copilotkit for AG-UI event enum + SSE encoder (fact-gathering only).

**Rationale:** getting a tool chunk field wrong (e.g. `toolCallId` vs `id`, `input` vs `args`) fails the card silently — warrants full reads. AG-UI needs breadth, not depth.

**Consequences:** deep on the producer + consumer contract; shallow on AG-UI (ADR fact only).

### D3 — The protocol-choice ADR is a required blueprint output

**Decision:** The blueprint MUST contain an ADR recommending `UIMessageStream` vs AG-UI as theokit's canonical agent wire, with evidence from both refs (not preference).

**Rationale:** the ROADMAP M1 gate names this ADR explicitly. M0 already shipped `UIMessageStream`; the ADR must justify continuing (or pivoting) with cited facts.

**Consequences:** Q7 gathers the AG-UI facts; the blueprint's ADR section records the decision + the rejected alternative + the re-evaluation trigger.

## Research Questions

Answer order (D-dependency): Q1 → Q2 → Q3 → Q5 → Q4 → Q6 → Q7.

| # | Question | Corner | Reference project(s) | Fase A (broad map) | Fase B (deep Read at hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Exact z.strictObject fields + ordering for the TOOL chunks (`tool-input-start`, `tool-input-delta`, `tool-input-available`, `tool-output-available`, `tool-output-error`) that render a tool-call in `useChat`? | techniques | `.claude/knowledge-base/references/ai-sdk/` | Read `packages/ai/src/ui-message-stream/ui-message-chunks.ts:46-121` | Read `to-ui-message-chunk.ts:180-319` for how `tool-call`/`tool-result`/`tool-error` map to those chunks + ordering | Per-chunk required fields + the input-streaming→input-available→output-available sequence + citations |
| Q2 | Exact REASONING chunk fields (`reasoning-start`, `reasoning-delta`, `reasoning-end`) + the `finish{finishReason}` frame? | techniques | `.claude/knowledge-base/references/ai-sdk/` | Read `ui-message-chunks.ts:122-137, 191-204` | Read `to-ui-message-chunk.ts:91-119, 343-371` (reasoning + finish mapping) | Reasoning chunk fields + finish.finishReason enum + citations |
| Q3 | How to map each theokit `AgentStreamEvent` (`ToolCallEvent{callId,toolName,input}`, `ToolResultEvent{callId,toolName,output,isError}`, `ThinkingEvent{content}`, `DoneEvent`) to the Q1/Q2 chunks — and where the reasoning `id` / tool `toolCallId` come from? | techniques | own repo | Read `packages/agents/src/bridge/agent-stream-events.ts:14-101` (variant fields) + `ui-message-stream-translator.ts:36-66` (M0 base) | Read the M0 translator's event loop to decide the extension shape (reasoning-open state, tool ordering) | AgentStreamEvent→chunk mapping table + `id` sourcing decision (crypto.randomUUID for reasoning; callId for tools) |
| Q4 | How does ai-sdk test tool/reasoning chunk emission — the fixture + assertion pattern to mirror for M1? | tests | `.claude/knowledge-base/references/ai-sdk/` | Grep `*.test.ts` in `packages/ai/src/ui-message-stream/` for `tool-input\|tool-output\|reasoning` | Read 1-2 representative test cases | Test-pattern summary + citations |
| Q5 | How to extend the M0 translator unit test (`ui-message-stream-translator.test.ts`) to cover tool + reasoning, mirroring `event-translator.test.ts` fixtures? | tests | own repo | Read `packages/agents/tests/unit/ui-message-stream-translator.test.ts` (M0 cases) + `event-translator.test.ts:54-122` (tool_call/tool_result fixtures) | Derive the RED cases: given ToolCall+ToolResult events → expect tool-input-available + tool-output-available sequence | RED-test skeleton per event type + schema-conformance note + citations |
| Q6 | Is `@ai-sdk/react`'s `useChat` alone sufficient to render a tool-call (does theokit/the E2E need `assistant-ui` / `@assistant-ui/*` as a dependency), and which exact `ToolCallMessagePart` fields does assistant-ui read to render the card? | deps | `.claude/knowledge-base/references/assistant-ui/` | Read `packages/react-ai-sdk/src/ui/utils/convertMessage.ts:212-297` | Read `packages/ui/src/components/assistant-ui/tool-fallback.tsx` (the card renderer) | Field list the card reads (toolName/toolCallId/argsText/args/result/isError) + E2E assertion target + whether assistant-ui is a test dep |
| Q7 | AG-UI protocol facts (event kinds, SSE transport, cross-vendor adoption, `@ag-ui/*` package) vs UIMessageStream — enough to write the canonical-protocol ADR? | tools | `.claude/knowledge-base/references/copilotkit/` | Grep `TOOL_CALL_\|RUN_STARTED\|@ag-ui` + `sse-response.ts` | Read `packages/runtime/src/v2/runtime/handlers/shared/sse-response.ts` + `packages/shared/src/finalize-events.ts` | AG-UI fact table (event-based/SSE/cross-vendor) + the ADR recommendation (keep UIMessageStream) with rejected alternative |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4, Q5 | Covered |
| Dependencies | Q6 (assistant-ui as E2E dep decision) | Covered |
| Tools | Q7 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Every `.claude/knowledge-base/references/{project}/{path}` declared exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | ≥ 1 hotspot OR 3 retries | After 3 empty, mark BLOCKED "Fase A exhausted" |
| Q1/Q2 correctness | Chunk fields cited from `ui-message-chunks.ts` (not inferred) | Re-read; no inference |
| Q3 mapping completeness | Every theokit tool/reasoning/done AgentStreamEvent variant has a target chunk OR an explicit "no chunk (M1-out)" | Re-read agent-stream-events.ts |
| Q1 tool lifecycle (EC-1) | Blueprint states whether `tool-input-available` alone materializes the tool part in `useChat`, OR `tool-input-start` must precede it — proven against `to-ui-message-chunk.ts` + the ToolUIPart state machine | Re-read; a card that doesn't render fails a DoD |
| Q3 interleave ordering (EC-2) | Blueprint defines the open/close state machine: an open text (or reasoning) block emits `text-end`/`reasoning-end` BEFORE any tool/reasoning/text chunk of a different kind | Re-read the M0 translator loop; dangling open parts break ordering |
| Q3 reasoning grouping (EC-3) | Consecutive `ThinkingEvent`s map to ONE reasoning block (one id) — not N | Specify the reasoning-open state like M0's text block |
| Q3 tool error branch (EC-4) | `ToolResultEvent.isError` maps `true`→`tool-output-error`, `false`→`tool-output-available` | Add the negative-case mapping |
| Q7 ADR evidence | The protocol recommendation cites BOTH ai-sdk and AG-UI facts, not preference | Gather the missing fact |
| Before promising complete | All 4 coverage corners populated | Refuse promise, continue |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly BLOCKED with reason
- [ ] All four coverage corners populated in the blueprint
- [ ] Every citation resolves to a real `.claude/knowledge-base/references/{...}` or own-repo `packages/...` path
- [ ] The blueprint's ADR section records the `UIMessageStream vs AG-UI` decision with a rejected alternative + re-eval trigger
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/ai-first-canonical-protocol-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → plan-confidence → execute → confidence → improve if needed)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100%
- [ ] ADRs reference at least one project rule: `architecture.md` (bridge is the only adapter), `sdk-runtime.md` (pure mapping), `testing.md` (RED before GREEN)
