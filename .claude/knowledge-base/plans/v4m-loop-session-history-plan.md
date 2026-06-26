---
slug: v4m-loop-session-history
milestone_id: V4-M
created_at: 2026-06-25
goal: Make AgentRunner reflective-loop rounds share a persisted SDK session so conversation history carries across rounds.
---

# Plan: V4-M — AgentRunner reflective-loop rounds carry conversation history (session persistence)

> **Version 1.1** (edge-case EC-1/EC-2 already in T2.1 scope; EC-3/EC-4 documented via ADRs D1/D3) — Close the blocking gap that prevents theocode adopting `AgentRunner.stream()`: today each round creates a FRESH, memoryless SDK agent (`Agent.create` + `dispose` per round, `sessionId` ignored, only `message + feedback` re-sent), so round N+1 cannot see what round N read or edited. V4-M makes the loop's rounds share a per-run SDK session via `Agent.getOrCreate(sessionId, { conversationStorage })` with one shared `conversationStorage` (default `InMemoryConversationStorage`), and changes the round prompt so rounds 2+ send only the continuation/feedback (the persisted session carries the prior turns). Built on the SDK's own documented design (session persistence; the SDK's `streamToCompletion` was extracted from theocode). Reuses SDK primitives (Rule 9); no new dependency.

## Goal

> "Enable `AgentRunner.stream()` rounds to share a persisted SDK session so round N+1 sees rounds 1..N, measured by `npx vitest run packages/agents/tests/integration/loop-session-history.test.ts` passing (each round calls `Agent.getOrCreate(sessionId, …)` with the SAME shared `conversationStorage`, and rounds 2+ send the continuation, not the original message)."

## Context

The V4-L slices (released `@theokit/agents@0.12.0`) made the per-request `Agent.create` surface fully expressible through `AgentRunner`. A rigorous discover (`knowledge-base/discoveries/blueprints/theocode-loop-adoption-gap-blueprint.md`) then proved the loop adoption is BLOCKED on a deeper gap: `runReflectiveLoopStream` does not carry conversation history across rounds. `buildPrompt` (`run-reflective-loop.ts:120-129`) forwards only `message + [reflection] feedback`; `createSdkAgentStream` (`sdk-adapter.ts`) creates a fresh agent per round, ignores `sessionId`, and disposes each round. theocode's `runCodeAgent` (`agent-stream.ts:146-263`) instead re-injects the window-bounded accumulated transcript every round (`buildContinuationHistory`). Adopting onto the memoryless loop would regress the code agent (round 2 blind to round 1). The user chose framework-first: ship V4-M, then theocode adopts. The SDK already provides the mechanism — `Agent.getOrCreate(agentId, opts)` resumes a persisted conversation; `conversationStorage` is pluggable (default `FileSystemConversationStorage`, `InMemoryConversationStorage` for the no-disk case); `send` persists via `appendMessage`, `getOrCreate` reloads via `getMessages`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/bridge/sdk-adapter.ts` | 210 | `47dd837` (2026-06-25) | `createSdkAgentStream` projects compiled + per-request options into a per-round SDK call | M8/V4-L fields still projected; SDK is the only runtime (G2); model-resolution precedence preserved |
| `packages/agents/src/loop/run-reflective-loop.ts` | 348 | `079f725` (2026-06-25) | the reflective loop driver; `buildPrompt` builds each round's prompt; `runReflectiveLoopStream` threads a stable `sessionId` per run | terminals (stop/error/length/step_limit/no_progress) unchanged; reflection/loop strategy hooks unchanged; budget + signal handling unchanged |
| `packages/agents/tests/integration/runtime-overrides.test.ts` | ~240 | (V4-L.2/L.3) | mocks `@theokit/sdk` capturing `Agent.create` | the V4-L tests stay green — the mock updates to also expose `Agent.getOrCreate` |
| `packages/agents/tests/integration/systemprompt-resolver-stream.test.ts` | ~70 | (V4-L.1) | mocks `@theokit/sdk` `Agent.create` | stays green — mock exposes `getOrCreate` |
| `packages/agents/tests/integration/loop-session-history.test.ts` (NEW) | 0 | — | (file to be created) | — |

### Current callers / dependents

- **Symbol:** `createSdkAgentStream(compiled, tools, apiKey, overrides?)` (`sdk-adapter.ts:65`) — callers: `agent-runner.ts` (stream), `agent-orchestrator.ts` (delegate), smoke + adapter tests. The internal change (Agent.create → getOrCreate + shared storage) is behind the same signature — callers unaffected.
- **Symbol:** `buildPrompt` (`run-reflective-loop.ts:120`) — internal to `runReflectiveLoopStream`; not exported. Changing rounds-2+ prompt content affects what each round's agent receives.
- **Symbol:** `RoundStreamFactory = (message, sessionId) => AsyncIterable<StreamEvent>` (`run-reflective-loop.ts:28`) — `sessionId` already passed per round (constant within a run); V4-M starts USING it as the agentId. Contract unchanged.
- **SDK:** `Agent.getOrCreate(agentId, options)` (`agent.d.ts:132`), `InMemoryConversationStorage` + `ConversationStorageAdapter` (barrel `index.d.ts:2189`), `AgentOptions.conversationStorage` (`types/agent.d.ts:452`).

### Domain glossary

- **session persistence** — the SDK persists a conversation by agent id via a `ConversationStorageAdapter`; `getOrCreate(id)` reloads it. Default `FileSystemConversationStorage` (`<cwd>/.theokit/agents/<id>/messages.jsonl`); `InMemoryConversationStorage` for the no-disk default used here.
- **shared storage** — ONE `conversationStorage` instance created per run (per `createSdkAgentStream` call), reused by every round's `getOrCreate`, so the per-round dispose does not lose history (the store is external to the agent).
- **continuation prompt** — rounds 2+ no longer re-send the original `message` (it is in the persisted session); they send the reflection feedback, or a default continuation when there is no feedback.

### Architecture boundaries affected

- `@theokit/agents` → `@theokit/sdk`: uses two more SDK primitives (`Agent.getOrCreate`, `InMemoryConversationStorage`) in the existing bridge call. SDK remains the only runtime (G2). No dependency-graph change (G1); no new dependency.

## Prior Art & Related Work

- **Internal discover** — `knowledge-base/discoveries/blueprints/theocode-loop-adoption-gap-blueprint.md`: confirms the gap + recommends threading `agentId`/`getOrCreate` as the smallest, prior-art-aligned fix; notes the SDK's session primitives were extracted from theocode.
- **SDK documented design** — `Agent.getOrCreate` + `conversationStorage` (`types/agent.d.ts:452-468`): the SDK's own session-persistence contract V4-M consumes.
- **In-repo precedent** — V4-L threaded per-request fields into the same `Agent.create`; V4-M changes the same call to `getOrCreate` with a shared store.

## Objective

- [ ] Each round calls `Agent.getOrCreate(sessionId, { …, conversationStorage })` (not `Agent.create`).
- [ ] ONE `conversationStorage` instance is created per run and reused by every round (asserted same reference).
- [ ] Rounds 2+ send the continuation/feedback, NOT the original `message` (round 1 sends `message`).
- [ ] `conversationStorage` is overridable via `RuntimeOverrides`/`AgentRunnerRunOptions` (default `InMemoryConversationStorage`).
- [ ] Backward compatibility: terminals, reflection/loop strategies, budget, signal, and the V4-L per-request fields are unchanged; the existing suite stays green (mocks updated for `getOrCreate`).

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `>=2.9.0` (installed) | npm | Owns `Agent.getOrCreate`, `InMemoryConversationStorage`, `conversationStorage` persistence. Consuming existing primitives. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | | No dependency added — `getOrCreate` + `InMemoryConversationStorage` are in the installed SDK. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — Per-run shared `conversationStorage` + `Agent.getOrCreate(sessionId)` per round

- **Decision:** `createSdkAgentStream` creates ONE `conversationStorage` (default `InMemoryConversationStorage`) in its closure and, each round, calls `Agent.getOrCreate(sessionId, { …opts, conversationStorage })`; the `sessionId` already threaded per round is the agent id. Per-round dispose stays (the store is external and survives it).
- **Rationale:** the SDK's documented session mechanism; the store (not the agent) holds history, so the existing per-round create/dispose lifecycle is preserved and rounds reload the conversation. `InMemoryConversationStorage` default avoids forcing disk I/O / a cwd, while remaining overridable for real persistence. Reuses SDK primitives (Rule 9); smallest change behind the unchanged factory signature.
- **Alternatives considered:** (a) Keep ONE live agent across rounds (no dispose) — REJECTED: the per-round factory does not own run-scoped lifecycle; a dispose-at-run-end hook would change the `RoundStreamFactory` contract and ripple to all mockers. (b) Accumulate the transcript and prepend via `buildReplayHistory` into the prompt — REJECTED: re-creates theocode's manual replay inside the bridge when the SDK's session does it natively (more code, more impedance). (c) Delegate the whole loop to the SDK's `streamToCompletion` — REJECTED: loses the `ReflectionStrategy`/`LoopStrategy` hooks (V4-C/D/K) that are the point of `AgentRunner`.
- **Consequences:** rounds become stateful (the loop's intended behavior). Default in-memory store is per-run ephemeral (cleared when the run ends) — apps wanting durable history pass a `FileSystemConversationStorage`/custom adapter.

### D2 — Rounds 2+ send the continuation/feedback, not the original message

- **Decision:** `buildPrompt` sends `message` on round 1; on rounds 2+ it sends the reflection `feedback` when present, else a default `CONTINUE_PROMPT` constant — never re-sending `message` (the session already holds it).
- **Rationale:** with the persisted session (D1), re-sending the original task each round would duplicate it in the conversation and waste context; theocode's loop sends a short continuation prompt for exactly this reason.
- **Alternatives considered:** (a) Keep re-sending `message + feedback` — REJECTED: duplicates the task in the now-persisted session (the bug D1 fixes would be half-applied). (b) Send empty on rounds 2+ when no feedback — REJECTED: a bare empty turn gives the model no instruction; a `CONTINUE_PROMPT` is the minimal correct nudge.
- **Consequences:** rounds-2+ prompt content changes (a behavior change to the loop). Documented in the changeset; the loop's terminals/strategies are unaffected.

### D3 — Default-on (the stateless reflective loop was a latent defect), documented as a fix

- **Decision:** session persistence is the default behavior of `AgentRunner.stream()` (not opt-in); there is no stateless mode.
- **Rationale:** a multi-round reflective loop whose rounds cannot see prior tool results is nearly useless — the prior stateless behavior was a latent bug, not a feature to preserve. Making it default keeps one coherent behavior (KISS) and is what every consumer needs.
- **Alternatives considered:** (a) Opt-in builder flag `.session(true)` — REJECTED: adds surface + a near-useless legacy mode nobody wants; YAGNI (G11). (b) Keep stateless default — REJECTED: leaves the loop broken for everyone.
- **Consequences:** a behavior change for any existing multi-round caller (they gain memory). Framework tests that mocked `Agent.create` update to `getOrCreate`. Communicated as a fix in the changeset (minor bump).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Behavior change: rounds become stateful + rounds-2+ prompt changes — risks surprising existing multi-round callers | Medium | Documented as a fix in the changeset; the integration suite covers the new wiring; terminals/strategies/budget unchanged | maintainer |
| Test mocks of `@theokit/sdk` must add `Agent.getOrCreate` | Low | Mechanical mock updates, typecheck-guarded; the new test asserts the wiring | maintainer |
| Default `InMemoryConversationStorage` is per-run ephemeral — no durable history unless an app passes a FS/custom adapter | Low | Documented; `conversationStorage` overridable via run-options; durable persistence is the app's choice | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (shared storage + getOrCreate in sdk-adapter; buildPrompt continuation in run-reflective-loop) ──▶ Phase 2 (wiring proofs + mock updates)
                                                                                                              │
                                                                                                              ▼
                                                                                                     Final Phase: Integration Validation
```

Sequential: Phase 2 proves the Phase 1 wiring.

---

## Phase 1: Shared session storage + continuation prompt

**Objective:** `createSdkAgentStream` uses one shared `conversationStorage` + `getOrCreate(sessionId)` per round; `buildPrompt` sends continuation on rounds 2+.

### T1.1 — sdk-adapter: shared `conversationStorage` + `Agent.getOrCreate(sessionId)`

#### Objective
`createSdkAgentStream` creates one `conversationStorage` (default `InMemoryConversationStorage`, overridable via `RuntimeOverrides.conversationStorage`) in its closure and calls `Agent.getOrCreate(sessionId, { …, conversationStorage })` each round; `sessionId` is used (no longer `_sessionId`).

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds `conversationStorage?` to `RuntimeOverrides`; lazily creates one shared store per run; switches the per-round `Agent.create` to `Agent.getOrCreate(sessionId, …)` with that store; uses the `sessionId` factory argument.
2. **Why it is necessary now** — it is the core of the fix (ADR D1): without the shared store + `getOrCreate`, rounds stay memoryless.

#### Evidence
`sdk-adapter.ts:65-73` (signature + dynamic import), `:101` (`(message, _sessionId)` — sessionId ignored), `:165-171` (`Agent.create({...})`), `:199` (`agent.dispose()`); SDK `agent.d.ts:132` (`getOrCreate`), barrel `InMemoryConversationStorage`.

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts — RuntimeOverrides += conversationStorage?; shared store; getOrCreate(sessionId, {..., conversationStorage}); use sessionId
packages/agents/tests/integration/loop-session-history.test.ts — RED tests added first (TDD)
```

#### Deep file dependency analysis
- `sdk-adapter.ts` (Baseline: per-round SDK call) — the factory closure holds `let storage`; on first round, after the dynamic import, `storage ??= overrides.conversationStorage ?? new sdk.InMemoryConversationStorage()`; each round `Agent.getOrCreate(sessionId, { apiKey, model, tools, ...m8, ...extra, conversationStorage: storage })`. Downstream: callers unaffected (same signature); the loop passes the same `sessionId` each round.

#### Deep Dives
- **Invariant:** the store is created ONCE per run and reused (same reference) across rounds, so per-round dispose does not lose history (the store is external to the agent).
- **Edge case:** an app-provided `overrides.conversationStorage` is used verbatim (e.g. a `FileSystemConversationStorage` for durable history).
- **Edge case:** `Agent.getOrCreate` mock in tests must return the same agent shape as `Agent.create` did.

#### Pseudo-code / Signatures
```ts
export interface RuntimeOverrides { /* … */ conversationStorage?: ConversationStorageAdapter }
export function createSdkAgentStream(compiled, tools, apiKey, overrides = {}) {
  const model = overrides.model ?? compiled.model ?? 'openai/gpt-4o-mini'
  let storage: ConversationStorageAdapter | undefined = overrides.conversationStorage
  return (message, sessionId) => ({ async *[Symbol.asyncIterator]() {
    const sdk = await import('@theokit/sdk')
    storage ??= new sdk.InMemoryConversationStorage()
    // …build m8 + extra…
    const agent = await sdk.Agent.getOrCreate(sessionId, { apiKey, model: { id: model }, tools: sdkTools, ...m8, ...extra, conversationStorage: storage })
    // …send + stream + dispose (unchanged)…
  }})
}
```

#### Tasks
1. Add `conversationStorage?: ConversationStorageAdapter` to `RuntimeOverrides` (type-only SDK import).
2. Hold one shared store in the factory closure; default `InMemoryConversationStorage`.
3. Replace `Agent.create` with `Agent.getOrCreate(sessionId, { …, conversationStorage })`; use `sessionId`.
4. Run typecheck.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Types compile: `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Pass: complexity — `npx eslint packages/agents/src/bridge/sdk-adapter.ts --max-warnings=0` (complexity rule clean)
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/loop-session-history.test.ts` ≥ 90% on changed files
- [ ] Pass: lint — `npx eslint packages/agents/src/bridge/sdk-adapter.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/bridge/sdk-adapter.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

### T1.2 — run-reflective-loop: continuation prompt on rounds 2+

#### Objective
`buildPrompt` sends `message` on round 1; on rounds 2+ sends `feedback` when present, else a `CONTINUE_PROMPT` constant — never re-sending `message`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds a `CONTINUE_PROMPT` constant; changes `buildPrompt`'s body so rounds 2+ no longer include `message`.
2. **Why it is necessary now** — with D1's persisted session, re-sending the original task duplicates it; rounds 2+ must continue, not restart (ADR D2).

#### Evidence
`run-reflective-loop.ts:119-129` (current `buildPrompt`: `round === 1 || !feedback ? message : ...`).

#### Files to edit
```
packages/agents/src/loop/run-reflective-loop.ts — CONTINUE_PROMPT constant; buildPrompt rounds-2+ continuation-only
packages/agents/tests/integration/loop-session-history.test.ts — RED test (extends the Phase 1 file)
```

#### Deep file dependency analysis
- `run-reflective-loop.ts` (Baseline: loop driver) — `buildPrompt` is internal; the change alters round-2+ prompt content. The step-limit hint (round === maxIterations) is preserved.

#### Deep Dives
- **Invariant:** round 1 sends `message` (+ optional step-limit hint) unchanged.
- **Edge case:** round 2+ with feedback → feedback; round 2+ without feedback (e.g. `react`/noop) → `CONTINUE_PROMPT`.

#### Pseudo-code / Signatures
```ts
const CONTINUE_PROMPT = 'Continue from the prior turns above; finish the task and give a final answer.'
function buildPrompt(round, maxIterations, message, feedback) {
  const hint = round === maxIterations ? `${STEP_LIMIT_HINT}\n\n` : ''
  const body = round === 1 ? message : (feedback ?? CONTINUE_PROMPT)
  return hint + body
}
```

#### Tasks
1. Add the `CONTINUE_PROMPT` constant.
2. Rewrite `buildPrompt`'s body for rounds 2+.
3. Run the tests.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Round 1 sends `message`, rounds 2+ send feedback-or-continuation: `npx vitest run packages/agents/tests/integration/loop-session-history.test.ts`
- [ ] Existing loop tests stay green: `npx vitest run packages/agents/tests/integration/reflective-loop-stream.test.ts packages/agents/tests/unit/reflection-context.test.ts`
- [ ] Pass: complexity — `npx eslint packages/agents/src/loop/run-reflective-loop.ts --max-warnings=0` (complexity rule clean)
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/loop-session-history.test.ts` ≥ 90% on `run-reflective-loop.ts` changed lines
- [ ] Pass: lint — `npx eslint packages/agents/src/loop/run-reflective-loop.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/loop/run-reflective-loop.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

---

## Phase 2: Wiring proofs + mock updates

**Objective:** prove the session wiring (getOrCreate + shared store across rounds + continuation prompt) and keep the V4-L mocks green.

### T2.1 — Integration: session wiring across rounds + mock updates

#### Objective
A multi-round run (mocked `@theokit/sdk`) calls `Agent.getOrCreate(sessionId, …)` every round with the SAME `conversationStorage` reference; round 1 sends `message`, round 2 sends the continuation; an app-provided `conversationStorage` override is honored; the V4-L mocks (which used `Agent.create`) are updated to `Agent.getOrCreate`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds `loop-session-history.test.ts` asserting the getOrCreate/shared-store/continuation wiring across a 2-round run; updates `runtime-overrides.test.ts` + `systemprompt-resolver-stream.test.ts` mocks to expose `Agent.getOrCreate`.
2. **Why it is necessary now** — the Goal's metric is the session-wiring test; and the V4-L mocks must keep compiling/passing under the create→getOrCreate change.

#### Evidence
`run-reflective-loop.ts` round loop (calls the factory per round with the same sessionId); the existing capture-mock pattern (`runtime-overrides.test.ts:14-50`).

#### Files to edit
```
packages/agents/tests/integration/loop-session-history.test.ts (NEW) — getOrCreate + shared store across rounds; round-1 message vs round-2 continuation; storage override
packages/agents/tests/integration/runtime-overrides.test.ts — mock exposes Agent.getOrCreate (capture); existing assertions preserved
packages/agents/tests/integration/systemprompt-resolver-stream.test.ts — mock exposes Agent.getOrCreate
```

#### Deep file dependency analysis
- New integration test + two mock updates. The V4-L tests captured `Agent.create` options; they switch to capturing `Agent.getOrCreate`'s 2nd arg (same options object) — assertions on `model`/`cwd`/`plugins`/etc. unchanged.

#### Deep Dives
- **Wiring assertions:** mock `Agent.getOrCreate = vi.fn((id, opts) => { captured.push({id, opts}); return agent })`; a `react` agent driven to 2 rounds (unique tool_call per round) → assert `captured[0].id === captured[1].id === sessionId`, `captured[0].opts.conversationStorage === captured[1].opts.conversationStorage` (same ref), and the round-2 send message is the continuation (capture `agent.send` arg per round).
- **Storage override:** pass `conversationStorage: sentinel` via run-options → assert `captured[0].opts.conversationStorage === sentinel`.
- **Round-1 vs round-2 prompt:** capture each round's `send(message)` arg → round 1 === original, round 2 === feedback/continuation (not original).

#### Pseudo-code / Signatures
```ts
// mock: Agent.getOrCreate captures (id, opts); agent.send captures message
const r = await runner.run('task', { apiKey: 'k', maxIterations: 3 })
expect(captured[0].id).toBe(captured[1].id)
expect(captured[0].opts.conversationStorage).toBe(captured[1].opts.conversationStorage)
expect(sentMessages[0]).toBe('task'); expect(sentMessages[1]).not.toBe('task')
```

#### Tasks
1. Create `loop-session-history.test.ts` (getOrCreate + shared store + continuation + override).
2. Update the two V4-L mocks to `Agent.getOrCreate`.
3. Run the tests.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Session wiring proven: `npx vitest run packages/agents/tests/integration/loop-session-history.test.ts`
- [ ] V4-L mocks green under getOrCreate: `npx vitest run packages/agents/tests/integration/runtime-overrides.test.ts packages/agents/tests/integration/systemprompt-resolver-stream.test.ts`
- [ ] Pass: complexity — `npx eslint packages/agents/tests/integration/loop-session-history.test.ts --max-warnings=0` (complexity rule clean)
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/loop-session-history.test.ts` exercises the getOrCreate + shared-store + continuation path
- [ ] Pass: lint — `npx eslint packages/agents/tests/integration/loop-session-history.test.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/tests/integration/loop-session-history.test.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | Rounds are memoryless (fresh agent, sessionId ignored) | T1.1, T2.1 | `Agent.getOrCreate(sessionId, { conversationStorage })` per round; test asserts same id + same store (ADR D1) |
| G2 | History lost across rounds (per-round dispose, no shared store) | T1.1, T2.1 | one shared `conversationStorage` per run survives dispose; test asserts same reference (ADR D1) |
| G3 | Rounds 2+ re-send the original message (duplication) | T1.2, T2.1 | `buildPrompt` sends continuation on rounds 2+; test asserts round-2 send ≠ original (ADR D2) |
| G4 | No way to plug durable storage | T1.1, T2.1 | `RuntimeOverrides.conversationStorage` override; test asserts honored (ADR D1) |
| G5 | Stateless default is a latent defect | T1.1, T1.2 | session is the default behavior (ADR D3) |
| G6 | Backward compat (V4-L fields + suite) | T2.1 | mocks updated to getOrCreate; V4-L assertions preserved; full suite green |
| G7 | No proof of the session wiring | T2.1 | integration captures getOrCreate calls + per-round send messages |

**Coverage: 7/7 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `rules/architecture.md` / G6)
- [ ] CHANGELOG.md updated — add a changeset under `.changeset/` (minor bump `@theokit/agents`); document the rounds-now-stateful behavior change
- [ ] Backward compatibility preserved across public API (V4-L fields + the factory signature unchanged; behavior change documented per ADR D3)
- [ ] Plan-specific: `npx vitest run packages/agents/tests/integration/loop-session-history.test.ts` passes (the Goal metric)
- [ ] **Runtime-metric proof** — n/a (no new counter)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR is merged, move this plan to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```

The default `InMemoryConversationStorage` is pure in-memory; the SDK owns the model call (mocked in tests). An app that opts into `FileSystemConversationStorage` introduces disk I/O, but V4-M adds no external call of its own.

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 1-2. The plan is NOT done until this chain passes.

**Objective:** the whole `@theokit/agents` suite is green with stateful rounds.

### Execution
```
npx vitest run packages/agents
npx vitest run --coverage packages/agents
npx tsc --noEmit -p packages/agents/tsconfig.test.json
npx eslint packages/agents/src/bridge/sdk-adapter.ts packages/agents/src/loop/run-reflective-loop.ts --max-warnings=0
```

### Acceptance Criteria
- [ ] All test suites green — `npx vitest run packages/agents`
- [ ] Coverage ≥ 90% on changed files — `npx vitest run --coverage packages/agents`
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings (changed files) — `npx eslint packages/agents/src/bridge/sdk-adapter.ts packages/agents/src/loop/run-reflective-loop.ts --max-warnings=0`
- [ ] Runtime-metric proof — n/a this slice
- [ ] Failure scenarios green — n/a (`(none — no external I/O touched)`)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
