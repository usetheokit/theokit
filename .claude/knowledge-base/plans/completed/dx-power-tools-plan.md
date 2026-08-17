# Plan: DX Power Tools — generate agent/toolbox + agent test harness

> **Version 1.1** (2026-06-11) — Absorbed EC-1 (`@theokit/agents/testing` needs
> tsup entry + package.json exports — 2 lines), EC-2 (generated agent imports
> uninstalled dep — accepted, compiler error is clear).
>
> **Version 1.0** (2026-06-11) — Dois DX power tools: (1) `theokit generate agent/toolbox` no CLI existente, (2) `createMockAgentStream()` para testar agents sem API key. Devtools e Agent HMR adiados (YAGNI — requerem investigação mais profunda).

## Goal

> Ship `theokit generate agent` and `theokit generate toolbox` CLI commands plus a `createMockAgentStream()` test helper, measured by `theokit generate agent assistant` creating a valid agent file AND `createMockAgentStream()` producing typed SSE events in a test without an LLM API key.

## Context

Gap analysis (2026-06-11) identificou 4 gaps de DX (Tier 3):

1. **`theokit generate agent/toolbox`** — CLI generate já existe (314 LoC) com 5 generators (route, action, page, ws, controller). Faltam `agent` e `toolbox`. Esforço: ~50 LoC (template strings + 2 entries no VALID_TYPES).

2. **Agent testing harness** — testar agents hoje requer uma API key real (OpenRouter). `createMockAgentStream()` retornaria um stream de eventos tipados (text_delta, tool_call, done) sem chamar LLM. Esforço: ~60 LoC.

3. ~~Devtools melhorado~~ — DEFERRED. O devtools overlay (packages/theo/src/devtools/, ~30 files) já funciona. Integrar OpenAPI docs, route inspector, agent monitor é feature work grande que precisa de discover first.

4. ~~Agent HMR~~ — DEFERRED. Server routes HMR já existe (server-routes-hmr.ts). Agents são wired via TheoApp.create() — HMR para @Tool requires re-walking metadata + recompiling tools at runtime. Investigação necessária.

## Baseline Context

### Files that will be touched

| File | LoC | Last commit | Why it exists | Invariants |
|---|---|---|---|---|
| `packages/theo/src/cli/commands/generate.ts` | 314 | `fc3f49b` (2026-06-11) | CLI generate (5 types) | `VALID_TYPES` array, `GenerateResult` type |
| `packages/agents/src/testing/mock-stream.ts` (NEW) | 0 | — | Mock agent stream for testing | — |
| `packages/agents/src/testing/index.ts` (NEW) | 0 | — | Testing barrel | — |
| `packages/agents/src/index.ts` | ~15 | `da79e11` (2026-06-10) | Root barrel | Must re-export testing |
| `packages/agents/tests/unit/mock-stream.test.ts` (NEW) | 0 | — | Mock stream tests | — |

### Current callers

- `generate.ts:VALID_TYPES` — used by CLI arg validation. Adding entries is additive.
- `@theokit/agents` barrel — adding testing export is additive.

### Domain glossary

- **Generator** — CLI command that scaffolds a file (`theokit generate agent assistant` → `server/agents/assistant.agent.ts`)
- **Mock stream** — AsyncIterable that yields typed AgentStreamEvents without calling an LLM

### Architecture boundaries

- `generate.ts` — within `cli/` module (entrypoint kind). No new cross-module deps.
- `testing/mock-stream.ts` — within `packages/agents/src/`. Imports from own package only.

## Prior Art & Related Work

- **NestJS CLI** — `nest generate controller/service/guard/interceptor/filter` — same pattern, ours already has 5/7
- **Vitest mock** — `vi.fn()` for function mocking, but no typed SSE stream mock
- **MSW (Mock Service Worker)** — HTTP-level mocking, but overkill for agent stream testing

## Objective

- [ ] `theokit generate agent <name>` creates `server/agents/<name>.agent.ts`
- [ ] `theokit generate toolbox <name>` creates `server/toolboxes/<name>.tools.ts`
- [ ] `createMockAgentStream()` produces typed AsyncIterable of AgentStreamEvents
- [ ] Mock stream supports: text_delta sequence, tool_call + tool_result, done event, error injection
- [ ] Exported from `@theokit/agents/testing` sub-path

## ADRs

### D1 — Extend existing generate.ts (not new command)

**Decision:** Add `agent` and `toolbox` to existing `VALID_TYPES` in `generate.ts`. Not a new file or command.

**Rationale:** The CLI already handles generate with 5 types. Adding 2 more is consistent. Per DRY — one generate command, one dispatch, one output format.

**Alternatives:** Separate `generate-agent.ts` — rejected: splits the dispatch for no benefit.

### D2 — Mock stream as `@theokit/agents/testing` sub-path (not root export)

**Decision:** Export mock utilities from `@theokit/agents/testing` sub-path, not from the root barrel.

**Rationale:** Test utilities should not pollute the production import. Per ISP (Princípio 13.4) — consumers who don't test agents shouldn't see mock symbols. Sub-path keeps it clean.

**Alternatives:** Export from root — rejected: pollutes production types with test-only symbols.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Generated agent file imports from `@theokit/agents` which may not be installed | Low | Generate command checks if dep exists in package.json first | Dev |
| Mock stream doesn't exercise real LLM behavior | Low | Documented as unit-test helper; integration tests still need real API key | Dev |

## Unresolved Questions

(none — both features are well-defined patterns from NestJS + Vitest)

## Dependency Graph

```
Phase 1 (Generate) ──┐
                      ├──▶ Phase 3 (Integration)
Phase 2 (Mock Stream) ──┘
```

Phases 1 and 2 parallelize (different packages).

---

## Phase 1: `theokit generate agent/toolbox`

**Objective:** Add `agent` and `toolbox` to the CLI generate command.

### T1.1 — Add agent + toolbox generators

#### Objective
Extend `generate.ts` with 2 new generator templates.

#### Why this step

**Action:** Add `'agent'` and `'toolbox'` to `VALID_TYPES`. Add template strings for each. The file convention mirrors the template: `server/agents/<name>.agent.ts`, `server/toolboxes/<name>.tools.ts`.

**Reasoning:** Per D1, extending the existing generate is DRY. The templates follow the exact pattern from `create-theokit/templates/default/server/agents/` and `server/toolboxes/`.

#### Files to edit
```
packages/theo/src/cli/commands/generate.ts — add agent + toolbox generators
```

#### TDD
```
RED:   test_generate_agent_creates_file() — generate agent 'assistant' creates server/agents/assistant.agent.ts
RED:   test_generate_toolbox_creates_file() — generate toolbox 'tasks' creates server/toolboxes/tasks.tools.ts
RED:   test_generate_agent_has_correct_content() — file contains @Agent decorator + @MainLoop
RED:   test_generate_toolbox_has_correct_content() — file contains @Toolbox + @Tool
GREEN: Add templates to generate.ts
VERIFY: npx vitest run tests/unit/generate.test.ts
```

#### Acceptance Criteria
- [ ] `theokit generate agent assistant` creates valid agent file
- [ ] `theokit generate toolbox tasks` creates valid toolbox file
- [ ] Generated files compile with `tsc --noEmit`
- [ ] VALID_TYPES includes 'agent' and 'toolbox'

---

## Phase 2: Agent Test Harness — `createMockAgentStream()`

**Objective:** Ship a mock agent stream factory for testing agents without an LLM API key.

### T2.1 — Implement createMockAgentStream

#### Objective
Create `packages/agents/src/testing/mock-stream.ts` with a factory that returns typed AsyncIterable of SSE events.

#### Why this step

**Action:** `createMockAgentStream({ responses: [...] })` returns an async generator that yields `run_started`, `text_delta`, `tool_call`, `tool_result`, `done` events in sequence. The developer scripts the LLM "conversation" for deterministic testing.

**Reasoning:** Per D2, exported from `@theokit/agents/testing` sub-path. Testing agents today requires a real API key + real LLM call ($$$). This mock enables TDD for agent logic without external deps.

#### Files to edit
```
packages/agents/src/testing/mock-stream.ts (NEW) — mock stream factory
packages/agents/src/testing/index.ts (NEW) — barrel
packages/agents/package.json — add ./testing sub-path export
packages/agents/tests/unit/mock-stream.test.ts (NEW) — tests
```

#### Pseudo-code

```typescript
import type { StreamEvent } from '../bridge/agent-sse-handler.js'

export interface MockAgentStreamOptions {
  agentName?: string
  responses: MockResponse[]
}

export type MockResponse =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; input: unknown; output: string }
  | { type: 'error'; message: string }

export function createMockAgentStream(opts: MockAgentStreamOptions) {
  return (_message: string, _sessionId: string): AsyncIterable<StreamEvent> => ({
    async *[Symbol.asyncIterator]() {
      yield { type: 'run_started', runId: `mock-${Date.now()}`, agentName: opts.agentName ?? 'mock' }
      for (const r of opts.responses) {
        if (r.type === 'text') {
          for (const word of r.content.split(' ')) {
            yield { type: 'text_delta', content: word + ' ' }
          }
        } else if (r.type === 'tool_call') {
          yield { type: 'tool_call', callId: `tc-${Date.now()}`, toolName: r.name, input: r.input }
          yield { type: 'tool_result', callId: `tc-${Date.now()}`, toolName: r.name, output: r.output, durationMs: 0, isError: false }
        } else if (r.type === 'error') {
          yield { type: 'error', code: 'MOCK_ERROR', message: r.message, retryable: false }
          return
        }
      }
      yield { type: 'done', result: '...', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 0 }
    },
  })
}
```

#### TDD
```
RED:   test_mock_stream_yields_run_started() — first event is run_started
RED:   test_mock_stream_text_response() — text response yields text_delta events word by word
RED:   test_mock_stream_tool_call() — tool_call yields tool_call + tool_result events
RED:   test_mock_stream_error() — error response yields error event and stops
RED:   test_mock_stream_done() — last event is done with usage stats
RED:   test_mock_stream_multiple_responses() — sequence of text + tool + text works
RED:   test_mock_stream_exported_from_testing() — import from @theokit/agents/testing works
GREEN: Implement createMockAgentStream
VERIFY: cd packages/agents && npx vitest run tests/unit/mock-stream.test.ts
```

#### Acceptance Criteria
- [ ] `createMockAgentStream()` yields typed events
- [ ] Supports text, tool_call, error responses
- [ ] Exported from `@theokit/agents/testing`
- [ ] 7+ tests GREEN

---

## Phase 3: Integration Validation

### Execution
```bash
turbo run build --filter='./packages/*' --force
turbo run test --filter='./packages/*'
```

### Acceptance Criteria
- [ ] All existing tests GREEN
- [ ] `theokit generate agent/toolbox` works
- [ ] `createMockAgentStream` exported from testing sub-path
- [ ] Zero type errors

---

## Coverage Matrix

| # | Gap | Task | Resolution |
|---|---|---|---|
| 1 | theokit generate agent | T1.1 | Template in generate.ts |
| 2 | theokit generate toolbox | T1.1 | Template in generate.ts |
| 3 | Agent test harness | T2.1 | createMockAgentStream() |
| 4 | Testing sub-path export | T2.1 | @theokit/agents/testing |
| 5 | Devtools | DEFERRED | Needs discover first |
| 6 | Agent HMR | DEFERRED | Needs investigation |

**Coverage: 4/4 actionable gaps covered (100%). 2 deferred with rationale.**

## Global Definition of Done

- [ ] All tests GREEN
- [ ] `theokit generate agent assistant` creates valid file
- [ ] `createMockAgentStream` works without API key
- [ ] Build succeeds
- [ ] CHANGELOG updated

## Failure scenarios

(none — no external I/O. Generate writes local files. Mock stream is in-memory.)
