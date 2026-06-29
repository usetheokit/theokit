---
slug: step-cap-force-close
created_at: 2026-06-29
goal: Guarantee a reflective-loop turn that hits maxIterations ends on a tool-free model summary (never a dangling tool), by running the final round with tools disabled.
---

# Plan: step-cap force-close (@theokit/agents)

## Goal
On `round === maxIterations`, run the model round with **tools disabled** so it is forced to produce a closing text summary — converting today's soft `STEP_LIMIT_HINT` into a hard guarantee. Metric: a loop driven by a factory that always returns `tool-calls` terminates on a tool-free `finalFactory` round (finishReason `stop`), proven by a deterministic unit test.

## Context / Baseline
- `run-reflective-loop.ts:80-82,157` already injects `STEP_LIMIT_HINT` ("final round — do not call tools; summarize") into the final-round prompt, but the round still runs with tools, so a non-cooperative model (observed: deepseek-v3.2 spinning) can keep calling tools at the ceiling.
- `run-reflective-loop.ts:469` calls `consumeRoundOrThrow({ factory, ... })` — the factory is per-call swappable.
- `agent-runner.ts:215-228` builds `streamFactory` once via `createSdkAgentStream(compiled, tools, apiKey, { sdkTools })`.
- Reference grounding (deep research): opencode forces a close at its step cap via `MAX_STEPS_PROMPT` + `toolChoice:"none"` (`session/runner/max-steps.ts`); codex relies on the same hint + token compaction. Neither has no-progress detection. This plan ports opencode's force-close.

## ADRs
- **ADR (REVISED after impl spike): `tool_choice:"none"` at send-level (cross-repo) — the empty-tools single-repo approach is BLOCKED.** The first attempt ran the final round through a tool-free factory (empty `tools`). **Verified blocker:** `Agent.getOrCreate(sessionId, opts)` returns the CACHED agent on a session hit and IGNORES `opts.tools` (`packages/sdk/src/agent.ts` — `const cached = registry.get(agentId); if (cached !== undefined) return cached`). The adapter resumes the same session every round (V4-M), so passing `tools:[]` on the final round does NOT disable the cached agent's tools. A second tool-free factory creates a SECOND session/storage → the final round loses prior-round history (it can't summarize) AND breaks the "storage created once / same session" invariants (3 agents tests failed). Therefore the robust path is the field standard: **disable tools per-SEND** via `tool_choice:"none"`, which the cached agent honors per request. Rejected alternatives: (a) empty-tools (blocked by cache, above); (b) `registry.configure({maxAgents:0})` to defeat the cache (heavy global side-effect; loses cross-round caching for every round); (c) fresh session + manual history seeding for the final round (re-implements session storage — violates sdk-runtime rule). `@theokit/agents` consumes `@theokit/sdk` via the permanent workspace link, so both layers are implemented + tested together locally; release is SDK-then-agents.

## Tasks (cross-repo; workspace-linked so both test locally before release)
### T1.1 — SDK: `toolChoice` plumbing (@theokit/sdk)
- **Files:** `packages/sdk/src/internal/llm/types.ts` (`LlmRequest.toolChoice?: "auto" | "none" | "required"`), `packages/sdk/src/internal/llm/openai.ts` (`buildOpenAIBody`: `if (request.toolChoice !== undefined) body.tool_choice = request.toolChoice`), `packages/sdk/src/internal/agent-loop/loop-types.ts` + `loop-llm-stream.ts` (thread `AgentLoopInputs.toolChoice` → request), and the public `SendOptions`/run path (`Agent.send(msg, { toolChoice })` → AgentLoopInputs).
- **TDD:** `__testing__buildOpenAIBody({ ...req, toolChoice: "none" })` ⇒ `body.tool_choice === "none"`; omitted when absent. Loop-level: `send({ toolChoice: "none" })` forwards it to the request.

### T1.2 — agents: pass `tool_choice:"none"` on the final round (@theokit/agents)
- **Files:** `packages/agents/src/bridge/sdk-adapter.ts` (factory + `agent.send(message, { onDelta, toolChoice })` — accept a per-call `disableTools` arg on the returned factory → maps to `toolChoice:"none"` at SEND time, NOT at getOrCreate), `packages/agents/src/loop/run-reflective-loop.ts` (on `round === loop.maxIterations`, call the factory with `disableTools: true`), `RoundStreamFactory` signature += optional `{ disableTools?: boolean }`.
- **TDD:** loop test with a fake factory that records the `disableTools` arg → asserts `true` only on the final round; SDK-path: adapter `send` receives `toolChoice:"none"` on the final round (spy). The cached agent (same session) is reused → final round still sees prior rounds AND emits a tool-free summary.

## Coverage Matrix
| Goal claim | Task |
|---|---|
| SDK request can disable tools per-send (`tool_choice:"none"`) | T1.1 |
| Final round sends `tool_choice:"none"` (cached-session-safe) | T1.2 |
| No regression to storage/session-once + sub-cap turns | T1.2 + existing suites |

## Test Plan
- New unit test in `packages/agents/tests/` for `runReflectiveLoopStream` finalFactory behavior (deterministic, fake factories).
- Full `@theokit/agents` suite green (no regression to step_limit / no_progress / continuation tests).
- typecheck + lint clean.

## Drawbacks & Risks
- **Empty-tools doesn't disable MCP/skill-injected tools** (only sdkTools/compiled.tools). Mitigation: covers the observed spin (sdkTools agents); `tool_choice:"none"` follow-up for full coverage. Owner: framework.
- **One extra model round at the ceiling** (the forced summary). Acceptable — it replaces a dangling tool / canned notice with a real summary; bounded by maxIterations itself.

## Unresolved Questions
- (none — `tool_choice:"none"` provider-level robustness is explicitly deferred to a follow-up SDK cycle.)

## Global DoD
- finalFactory used on the final round; deterministic test green; full agents suite green; tsc 0; lint 0; CHANGELOG + changeset.
