# Plan: SDK Integration — Replace llm-runner.ts with @theokit/sdk Runtime

> **Version 1.0** (2026-06-11) — Replace TheoKit's reimplemented LLM runner with `@theokit/sdk` `Agent.create()` + `Run.stream()`. Delete 182 LoC of duplicated code. Enforce `sdk-runtime.md` rule. Based on blueprint `sdk-integration-blueprint.md`.

## Goal

> Replace `llm-runner.ts` with a thin SDK adapter so that all agent execution flows through `@theokit/sdk`, measured by `grep -rn "openrouter.ai" packages/ --include="*.ts"` returning ZERO results AND all existing agent tests passing with the SDK adapter.

## Context

Blueprint `sdk-integration-blueprint.md` confirmed: SDK's `defineTool()` maps 1:1 to TheoKit's `compileTools()`, OpenRouter provider is built-in, `ConversationStorageAdapter` replaces the session Map. Rule `sdk-runtime.md` (INQUEBRÁVEL) codified: no direct LLM API calls.

## Baseline Context

### Files that will be touched

| File | LoC | Last commit | Why it exists | Invariants |
|---|---|---|---|---|
| `packages/agents/src/bridge/llm-runner.ts` | 182 | `da79e11` (2026-06-10) | Direct OpenRouter calls (TO DELETE) | `createRealAgentStream()` signature |
| `packages/agents/src/bridge/sdk-adapter.ts` (NEW) | 0 | — | SDK adapter replacing llm-runner | — |
| `packages/agents/src/bridge/event-translator.ts` (NEW) | 0 | — | SDKMessage → AgentStreamEvent | — |
| `packages/agents/src/bridge/index.ts` | ~70 | `2643eac` (2026-06-10) | Bridge barrel | Must export new adapter |
| `packages/agents/package.json` | ~50 | `f8f2710` (2026-06-11) | Package manifest | Must add @theokit/sdk peerDep |
| `packages/http/src/app.ts` | ~490 | `2986812` (2026-06-11) | TheoApp | `autoWireAgents` imports `createRealAgentStream` |
| `fixtures/demo-faang/server/llm-agent-runner.ts` | ~180 | `da79e11` (2026-06-10) | Fixture copy (TO DELETE) | — |

### Architecture boundaries

- `packages/agents/` adds `@theokit/sdk` as peerDep (allowed — agents is downstream of SDK)
- `packages/http/` import of `createRealAgentStream` changes to `createSdkAgentStream` (same package boundary)

## Prior Art & Related Work

- **Blueprint:** `discoveries/blueprints/sdk-integration-blueprint.md` — 6 questions, event translation map
- **Rule:** `.claude/rules/sdk-runtime.md` — SDK is ONLY runtime (INQUEBRÁVEL)

## Objective

- [ ] Create `sdk-adapter.ts` with `createSdkAgentStream()` using SDK `Agent.create()` + `Run.stream()`
- [ ] Create `event-translator.ts` mapping SDKMessage → AgentStreamEvent (7 types)
- [ ] Delete `llm-runner.ts` (182 LoC)
- [ ] Delete `fixtures/demo-faang/server/llm-agent-runner.ts`
- [ ] Update `app.ts` to use `createSdkAgentStream`
- [ ] Add `@theokit/sdk` as peerDep to agents package
- [ ] Zero `openrouter.ai` references in production code

## ADRs

### D1 — SDK as single runtime (codified as rule)

**Decision:** All agent execution delegates to `@theokit/sdk`. Per rule `sdk-runtime.md`.

**Rationale:** DRY (Princípio 12) — SDK already implements LLM calls, tool execution, session management, budget tracking, 9+ providers. Reimplementing is waste.

**Alternatives:** Keep llm-runner.ts alongside SDK — rejected: violates DRY, doubles bug surface, provider lock-in to OpenRouter only.

### D2 — Event translator as separate file (not inline)

**Decision:** `event-translator.ts` as dedicated module (~40 LoC). Not inline in adapter.

**Rationale:** SRP (Princípio 13.1) — translation logic is a distinct concern from SDK wiring. Testable independently.

**Alternatives:** Inline in adapter — rejected: adapter would exceed 100 LoC; translation is independently testable.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| SDK version mismatch (1.5.0 vs latest 1.6.2-next) | Medium | Pin `@theokit/sdk: "^1.5.0"` as peerDep; test against installed version | Dev |
| SDK Agent.create() is async — slight startup overhead | Low | Already async in TheoApp.create() — no behavioral change | Dev |
| SDK event types (SDKMessage) may not cover all TheoKit events | Medium | Event translator handles missing types gracefully (passthrough) | Dev |

## Unresolved Questions

(none — blueprint resolved all 6 questions with file:line evidence)

## Dependency Graph

```
Phase 1 (Adapter + Translator) ──▶ Phase 2 (Wire + Delete) ──▶ Phase 3 (Validation)
```

---

## Phase 1: SDK Adapter + Event Translator

**Objective:** Create the adapter and translator modules.

### T1.1 — Create event-translator.ts

#### Files to edit
```
packages/agents/src/bridge/event-translator.ts (NEW)
```

#### TDD
```
RED:   test_translate_assistant_to_text_delta() — SDKAssistantMessage → text_delta
RED:   test_translate_tool_call() — SDKToolUseMessage → tool_call + tool_result
RED:   test_translate_system_to_run_started() — SDKSystemMessage → run_started
RED:   test_translate_status_done() — SDKStatusMessage(done) → done with usage
RED:   test_translate_unknown_passthrough() — unknown type yields nothing (no crash)
GREEN: Implement translator
```

### T1.2 — Create sdk-adapter.ts

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts (NEW)
packages/agents/package.json — add @theokit/sdk peerDep
```

#### TDD
```
RED:   test_sdk_adapter_creates_agent() — createSdkAgentStream creates Agent with correct model
RED:   test_sdk_adapter_passes_tools() — compiled tools passed as defineTool() to Agent
RED:   test_sdk_adapter_streams_events() — stream yields translated events
GREEN: Implement adapter
```

---

## Phase 2: Wire + Delete

### T2.1 — Replace llm-runner with sdk-adapter

#### Files to edit
```
packages/agents/src/bridge/index.ts — export createSdkAgentStream, remove createRealAgentStream
packages/http/src/app.ts — import createSdkAgentStream instead of createRealAgentStream
packages/agents/src/bridge/agent-orchestrator.ts — use createSdkAgentStream
packages/agents/src/bridge/llm-runner.ts — DELETE
fixtures/demo-faang/server/llm-agent-runner.ts — DELETE
```

#### TDD
```
RED:   test_no_openrouter_references() — grep returns 0 matches in packages/
GREEN: Delete files + update imports
```

---

## Phase 3: Integration Validation

```bash
turbo run build test --filter='./packages/*' --force
grep -rn "openrouter.ai" packages/ --include="*.ts" | grep -v test | grep -v mock  # must be ZERO
```

## Coverage Matrix

| # | Gap | Task | Resolution |
|---|---|---|---|
| 1 | Direct LLM API calls | T2.1 | Delete llm-runner.ts |
| 2 | Reimplemented tool loop | T1.2 | SDK Agent handles tools |
| 3 | Reimplemented sessions | T1.2 | SDK ConversationStorage |
| 4 | Single provider (OpenRouter) | T1.2 | SDK 9+ providers |
| 5 | Event type mismatch | T1.1 | event-translator.ts |
| 6 | sdk-runtime rule enforcement | T2.1 | grep guard = 0 results |

**Coverage: 6/6 (100%)**

## Global DoD

- [ ] Zero `openrouter.ai` in production code
- [ ] `@theokit/sdk` as peerDep in agents
- [ ] `llm-runner.ts` deleted
- [ ] All tests GREEN
- [ ] Build succeeds
- [ ] `sdk-runtime.md` rule satisfied

## Failure scenarios

(none — SDK handles LLM I/O; adapter is pure translation layer)
