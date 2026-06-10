---
slug: theokit-agent-dogfood-gaps
created_at: 2026-06-10
goal: Ship token-by-token streaming, multi-turn conversation, model from decorator metadata, consistent tool names, proper Zod-to-JSON-Schema, budget enforcement, and abort support in the LLM agent runner, measured by a live dogfood where the browser shows typing animation with multi-turn history and cost tracking.
---

# Plan: Fix 7 Dogfood Gaps in Agent LLM Runner

> **Version 1.1** (2026-06-10) — Absorbed EC-1 (streaming JSON parse safety via line buffering), EC-2 (session TTL eviction), EC-3 (budget cost from last chunk only), EC-4 (abort race with stream end), EC-5 (model provider prefix auto-detect).
>
> **Version 1.0** — Fix all 7 gaps discovered during live dogfood testing of the FAANG demo with real LLM (OpenRouter). Single file focus: `llm-agent-runner.ts`. Each gap is a task.

## Goal

> Ship token-by-token SSE streaming, multi-turn conversation with session persistence, decorator-driven model selection, consistent tool naming, SDK-grade Zod→JSON Schema conversion, real-time budget enforcement, and AbortController cancel support in the agent runner, measured by a live dogfood test where the browser shows typing animation across 3+ conversation turns with cost displayed.

## Context

Live dogfood test (2026-06-10) proved the agent works end-to-end: user → LLM → tool_call → tool_result → response → SSE → browser. But 7 UX/correctness gaps were found. All are in `fixtures/demo-faang/server/llm-agent-runner.ts` (215 LoC) — the bridge between decorator metadata and OpenRouter API.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Why it exists | Invariants to preserve |
|---|---|---|---|
| `fixtures/demo-faang/server/llm-agent-runner.ts` | 215 | Bridge: decorator metadata → OpenRouter API | Tool calling loop, SSE event format |
| `fixtures/demo-faang/demo-launcher.ts` | ~300 | Entry point with frontend HTML | Server structure, frontend layout |

### Current callers / dependents

- **`createRealAgentStream()`** — called from `demo-launcher.ts:55` via `createRun`.
- **Frontend HTML** — parses SSE events in `demo-launcher.ts` inline `<script>`.

### Domain glossary

- **Token-by-token streaming** — OpenRouter `stream: true` returns chunks via SSE where each chunk contains 1-5 tokens.
- **Multi-turn** — Maintaining `messages[]` across HTTP requests, keyed by `sessionId`.
- **Budget enforcement** — Tracking cumulative cost per session and stopping when `@Budget({ maxCostUsd })` is exceeded.

### Architecture boundaries affected

- Fixture only — no package source modified.

## Prior Art & Related Work

- **External:** OpenRouter streaming API — `stream: true` returns `text/event-stream` with `data: {"choices":[{"delta":{"content":"token"}}]}` chunks.
- **External:** Vercel AI SDK `useChat()` — conversation state management pattern.

## Objective

- [ ] Gap 1: Token-by-token streaming (`stream: true` + SSE delta parsing)
- [ ] Gap 2: Multi-turn conversation (session-keyed `messages[]` Map)
- [ ] Gap 3: Model from `@Agent({ model })` metadata (not env var)
- [ ] Gap 4: Consistent tool names (store original + sanitized mapping)
- [ ] Gap 5: Proper Zod→JSON Schema (use `zodToJsonSchema` from zod or inline robust converter)
- [ ] Gap 6: Budget enforcement (track cost per session, stop at limit)
- [ ] Gap 7: AbortController cancel support

## ADRs

### D490 — Use OpenRouter streaming API with delta chunking

**Decision:** Set `stream: true` in the OpenRouter request. Parse SSE chunks with `delta.content` tokens. Yield one `text_delta` SSE event per chunk to the browser.

**Rationale:** Token-by-token streaming is the expected UX for AI chat. Without it, users see a loading spinner then a wall of text. Every major AI product (ChatGPT, Claude, Gemini) streams token-by-token.

**Alternatives considered:**
- (a) Keep non-streaming and split the response into fake chunks — rejected: adds latency and complexity without improving TTFB.

**Consequences:** More complex SSE parsing (chunked `data: [DONE]` termination). Slightly more code in the runner.

### D491 — Session-keyed conversation Map for multi-turn

**Decision:** Maintain a `Map<string, Message[]>` in memory, keyed by `sessionId`. Each request appends user message + assistant response. The LLM sees the full conversation history on each turn.

**Rationale:** Without conversation history, the agent can't reference previous turns. This is the minimum viable multi-turn implementation. Production would use database persistence.

**Alternatives considered:**
- (a) Persist to filesystem — rejected: adds I/O complexity for a fixture. In-memory is sufficient for dogfood.

**Consequences:** Memory grows with conversation length. Acceptable for demo (no production traffic).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| In-memory conversation lost on server restart | Low | Acceptable for demo. Production uses DB. | Implementer |
| OpenRouter streaming format may differ from OpenAI | Low | OpenRouter is OpenAI-compatible. Test with real call. | Implementer |
| Budget enforcement is per-process (not per-user in production) | Low | Demo-grade. Production uses @theokit/di REQUEST scope. | Implementer |

## Unresolved Questions

(none — every decision is resolved at plan time. All 7 gaps have clear implementations.)

## Dependency Graph

```
T1 (streaming) ──▶ T2 (multi-turn — needs streaming to work)
T3 (model)     ──\ 
T4 (tool names) ──▶ All independent, can parallelize
T5 (zod schema) ──/
T6 (budget)    ──▶ Needs T1 (reads usage from streaming chunks)
T7 (abort)     ──▶ Needs T1 (AbortController on streaming fetch)
```

---

## Phase 1: Core Fixes (Streaming + Multi-turn)

**Objective:** Token-by-token streaming and conversation history.

### T1.1 — Token-by-token streaming

#### Objective
Switch from `stream: false` to `stream: true` in OpenRouter requests. Parse SSE chunks and yield individual `text_delta` events per token.

#### Why this step
**Action:** Enable real-time token streaming from LLM to browser.
**Reasoning:** Per D490, this is the #1 UX gap. Users expect typing animation, not loading → wall of text.

#### Files to edit
```
fixtures/demo-faang/server/llm-agent-runner.ts — add stream: true, parse SSE chunks
```

#### TDD
```
RED:     Live test: curl SSE shows multiple text_delta events (not one big one)
GREEN:   Implement streaming parser with line buffering (EC-1: buffer incomplete chunks before JSON.parse)
VERIFY:  curl -N POST /api/agents/planner/chat shows token-by-token events
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `curl -N` shows 5+ separate `text_delta` events per response (not 1 giant one)
- [ ] Each `text_delta` contains 1-20 tokens (not the full response)
- [ ] `done` event still fires with usage stats at the end
- [ ] EC-1: Partial JSON chunks buffered, not parsed (no crash on split boundaries)

#### DoD
- [ ] Live dogfood: browser shows typing animation

### T1.2 — Multi-turn conversation

#### Objective
Maintain conversation history per sessionId across HTTP requests.

#### Why this step
**Action:** Enable the agent to reference previous turns.
**Reasoning:** Per D491, without history the agent starts fresh every message. Users expect "remember what I said."

#### Files to edit
```
fixtures/demo-faang/server/llm-agent-runner.ts — add sessions Map
fixtures/demo-faang/demo-launcher.ts — pass sessionId from frontend
```

#### TDD
```
RED:     Live test: second message references first message's context
GREEN:   Implement session Map with TTL eviction (EC-2: sessions older than 1h cleaned up every 5min)
VERIFY:  Ask "mark it done" after listing tasks — agent knows which task
```

#### Concurrency tests
(none — single-threaded; Map is per-process)

#### Acceptance Criteria
- [ ] Second message in same session references first message's context
- [ ] Different sessionIds get independent histories
- [ ] Frontend sends consistent sessionId per chat session

#### DoD
- [ ] Live dogfood: 3-turn conversation works

---

## Phase 2: Correctness Fixes

**Objective:** Model metadata, tool names, Zod schema.

### T2.1 — Model from @Agent metadata

#### Objective
Use `agentWalk.agentConfig.model` as the LLM model, with env var as override.

#### Files to edit
```
fixtures/demo-faang/server/llm-agent-runner.ts — read model from metadata
```

#### TDD
```
RED:     Model in SSE run_started event matches @Agent({ model }) value
GREEN:   Implement metadata-driven model selection
VERIFY:  run_started event shows correct model
```

#### Acceptance Criteria
- [ ] Model from `@Agent({ model })` used by default
- [ ] EC-5: Models without provider prefix auto-prepend `anthropic/` (e.g., `claude-sonnet-4-5-20250929` → `anthropic/claude-sonnet-4-5-20250929`)
- [ ] `LLM_MODEL` env var overrides when set

#### DoD
- [ ] run_started shows correct model

### T2.2 — Consistent tool names

#### Objective
Store both original (dot-separated) and sanitized (underscore) names. SSE events use original names.

#### Files to edit
```
fixtures/demo-faang/server/llm-agent-runner.ts — dual name mapping
```

#### TDD
```
RED:     SSE tool_call event shows "project.list_tasks" (dot), not "project_list_tasks" (underscore)
GREEN:   Implement name mapping
VERIFY:  tool_call events match manifest names
```

#### Acceptance Criteria
- [ ] SSE events use dot-separated names (matching manifest)
- [ ] OpenRouter receives underscore names (its requirement)
- [ ] Mapping is bidirectional and consistent

#### DoD
- [ ] Manifest and SSE events show same names

### T2.3 — Proper Zod→JSON Schema

#### Objective
Replace the fragile manual converter with a robust implementation that handles nested objects, arrays, enums, defaults, optional.

#### Files to edit
```
fixtures/demo-faang/server/llm-agent-runner.ts — rewrite convertZodToJsonSchema
```

#### TDD
```
RED:     Tool with nested Zod schema (z.object({ user: z.object({ name: z.string() }) })) produces correct JSON Schema
GREEN:   Implement robust converter
VERIFY:  OpenRouter accepts all tool schemas without error
```

#### Acceptance Criteria
- [ ] Handles: string, number, boolean, enum, optional, default, nested object, array
- [ ] Produces valid JSON Schema accepted by OpenRouter

#### DoD
- [ ] All 7 tools compile to valid JSON Schema

---

## Phase 3: Production Features

**Objective:** Budget enforcement and abort support.

### T3.1 — Budget enforcement

#### Objective
Track cumulative cost per session. Stop agent when `@Budget({ maxCostUsd })` threshold is exceeded.

#### Files to edit
```
fixtures/demo-faang/server/llm-agent-runner.ts — add cost tracking
fixtures/demo-faang/demo-launcher.ts — display cost in frontend
```

#### TDD
```
RED:     After spending > $1.00 in a session, agent returns budget_exceeded error
GREEN:   Implement cost tracking from OpenRouter usage.cost field (EC-3: cost only available in last chunk after [DONE] — accumulate after stream ends)
VERIFY:  Live test: cost displayed in frontend after each message
```

#### Acceptance Criteria
- [ ] Cumulative cost tracked per session
- [ ] Agent stops with `budget_exceeded` error when limit hit
- [ ] Cost displayed in done event

#### DoD
- [ ] Frontend shows cost per message

### T3.2 — AbortController cancel

#### Objective
Wire AbortController so users can cancel a running agent.

#### Files to edit
```
fixtures/demo-faang/server/llm-agent-runner.ts — accept AbortSignal
fixtures/demo-faang/demo-launcher.ts — add cancel button in frontend
```

#### TDD
```
RED:     Clicking cancel mid-stream stops the SSE and the LLM call
GREEN:   Implement AbortController wiring (EC-4: check signal.aborted before yielding done event to prevent race)
VERIFY:  Cancel button stops streaming immediately
```

#### Acceptance Criteria
- [ ] Cancel button appears during streaming
- [ ] Clicking cancel aborts the fetch to OpenRouter
- [ ] SSE stream closes cleanly

#### DoD
- [ ] Live dogfood: cancel works mid-stream

---

## Coverage Matrix

| # | Gap | Task | Resolution |
|---|---|---|---|
| 1 | No token-by-token streaming | T1.1 | `stream: true` + SSE delta parsing |
| 2 | No conversation history | T1.2 | Session-keyed `Map<string, Message[]>` |
| 3 | @Agent({ model }) ignored | T2.1 | Read model from decorator metadata |
| 4 | Tool names inconsistent | T2.2 | Dual name mapping (dot ↔ underscore) |
| 5 | Zod→JSON Schema fragile | T2.3 | Robust converter |
| 6 | @Budget not enforced | T3.1 | Per-session cost tracking |
| 7 | No abort/cancel | T3.2 | AbortController wiring |

**Coverage: 7/7 gaps covered (100%)**

## Global Definition of Done

- [ ] All 7 gaps fixed and verified via live dogfood
- [ ] Browser shows typing animation (token-by-token)
- [ ] 3+ turn conversation works
- [ ] Cost displayed per message
- [ ] Cancel button stops streaming
- [ ] Existing tests GREEN (bun test)
- [ ] File-size budget: `llm-agent-runner.ts` ≤ 400 LoC

## Failure scenarios

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| OpenRouter API | 429 rate limit | Send 20 rapid requests | SSE error event with `retryable: true` |
| OpenRouter API | Network timeout | Kill network mid-stream | SSE error event, stream closes |
| OpenRouter streaming | Malformed SSE chunk | Mock with truncated JSON | Skip malformed chunk, continue stream |

## Final Phase: Integration Validation (MANDATORY)

### Execution

```bash
# Start demo with real LLM
OPENROUTER_API_KEY=$KEY bun fixtures/demo-faang/demo-launcher.ts

# Test 1: Token streaming (expect 5+ text_delta events)
curl -N -X POST localhost:4000/api/agents/planner/chat -H "Content-Type: application/json" -H "x-role: user" -d '{"message":"List tasks"}'

# Test 2: Multi-turn (second message references first)
curl -X POST localhost:4000/api/agents/planner/chat -H "Content-Type: application/json" -H "x-role: user" -d '{"message":"List tasks","sessionId":"test-1"}'
curl -X POST localhost:4000/api/agents/planner/chat -H "Content-Type: application/json" -H "x-role: user" -d '{"message":"Mark the first one as done","sessionId":"test-1"}'

# Test 3: Budget (verify cost in done event)
# Test 4: Existing tests
bun test packages/http-decorators/tests/unit/ packages/agents/tests/
```

### Acceptance Criteria

- [ ] Token-by-token streaming visible in browser
- [ ] Multi-turn conversation works (3+ turns)
- [ ] Cost tracking visible
- [ ] Cancel button functional
- [ ] 400+ existing tests GREEN
