---
slug: sdk-integration
version: "1.0"
created: 2026-06-11
question: "How should TheoKit's @Agent decorator system delegate to @theokit/sdk runtime instead of reimplementing LLM calls, tool execution, budget tracking, and conversation storage?"
---

# Discovery Plan: SDK Integration — Replace llm-runner.ts with @theokit/sdk Runtime

## Context

Audit (2026-06-11) revealed that TheoKit reimplements ~80% of what `@theokit/sdk` already provides. The `llm-runner.ts` (182 LoC) calls OpenRouter API directly instead of using `Agent.create()` / `Run.stream()`. This violates the CLAUDE.md invariant: *"@theokit/sdk é a agent runtime — sempre."*

**What TheoKit reimplements (should delete):**
- LLM API calls (fetch to OpenRouter) → SDK has `Agent.send()` with multi-provider support
- Tool execution loop → SDK has built-in tool calling with retry
- Session management (Map + TTL) → SDK has `ConversationStorage`
- Budget tracking (per-session cost) → SDK has `Budget` class
- Zod→JSON Schema conversion → SDK has `defineTool()` with schema handling

**What must happen:** `llm-runner.ts` is replaced by a thin adapter that calls `@theokit/sdk` `Agent.create()` + `Run.stream()`. The `@Agent` decorator compiles to SDK calls, not raw HTTP.

**New rule to enforce:** `@theokit/sdk` is the ONLY LLM runtime. No direct API calls to OpenRouter/Anthropic/OpenAI from TheoKit code.

## Objective

> Produce a blueprint mapping every SDK API to its TheoKit consumer, with a migration plan to replace `llm-runner.ts` + duplicated budget/session/tool code with SDK calls, measured by the blueprint having file:line citations for both SDK source and TheoKit source for each integration point.

## In-scope

| Reference | Directories | Focus |
|---|---|---|
| theokit-sdk (sibling) | `../theokit-sdk/packages/sdk/src/` | Agent.create, Run.stream, defineTool, Budget, ConversationStorage, providers |
| TheoKit agents | `packages/agents/src/bridge/llm-runner.ts` | What to replace |
| TheoKit agents | `packages/agents/src/bridge/agent-compiler.ts` | How tools are compiled |
| TheoKit agents | `packages/agents/src/bridge/agent-orchestrator.ts` | How delegate() works |
| TheoKit core | `packages/theo/src/server/agent/` | create-conversation-history, stream-agent-run |

## Out-of-scope

- SDK sub-packages (sdk-memory, sdk-cache, sdk-handoff) — deferred to Phase 2
- Gateway packages (telegram, discord, etc.) — separate integration
- SDK CLI (`@theokit/cli`) — not relevant to TheoKit framework

## Research Questions

### Corner: Techniques

**Q1.** What is the exact signature and return type of `Agent.create()` + `Agent.send()` + `Run.stream()`? What events does the stream yield? (`../theokit-sdk/packages/sdk/src/agent.ts`)

**Q2.** How does `defineTool()` from SDK compare to TheoKit's `compileTools()`? Can `@Tool` decorator metadata be passed directly to `defineTool()`? (`../theokit-sdk/packages/sdk/src/define-tool.ts`)

**Q3.** How does SDK's `Budget` class track cost? Can TheoKit's `@Budget` decorator delegate to it? (`../theokit-sdk/packages/sdk/src/budget.ts`)

### Corner: Integration tests

**Q4.** Does the SDK have integration tests for `Agent.create()` + tool calling + streaming? What test patterns can TheoKit reuse? (`../theokit-sdk/packages/sdk/tests/` or similar)

### Corner: Dependencies

**Q5.** What providers does SDK support (OpenAI, Anthropic, Ollama, OpenRouter)? Does it handle the OpenRouter API format that `llm-runner.ts` currently uses? (`../theokit-sdk/packages/sdk/src/internal/providers/`)

### Corner: Tools

**Q6.** What is the SDK's conversation storage interface? Can TheoKit's session Map be replaced by SDK's `ConversationStorage`? (`../theokit-sdk/packages/sdk/src/internal/persistence/`)

## Coverage Matrix

| # | Question | Corner | Method | Expected answer |
|---|---|---|---|---|
| Q1 | Agent.create/send/stream API | Techniques | Read `agent.ts` | Signature + event types |
| Q2 | defineTool vs compileTools | Techniques | Read `define-tool.ts` + `agent-compiler.ts` | Compatibility assessment |
| Q3 | Budget class | Techniques | Read `budget.ts` | Delegation feasibility |
| Q4 | SDK test patterns | Tests | Find test files in sdk repo | Reusable patterns |
| Q5 | Provider support | Deps | Read `internal/providers/` | OpenRouter compatibility |
| Q6 | ConversationStorage | Tools | Read `internal/persistence/` | Interface shape |

**Coverage: 6/6 questions across 4 corners (100%)**

## Halt-loop checkpoints

1. Q1 answered (Agent API shape known) before designing adapter
2. Q5 answered (provider compatibility confirmed) before proposing llm-runner.ts deletion
3. All 6 questions answered → blueprint draft

## Acceptance Criteria

- [ ] Every question answered with file:line citation from SDK source
- [ ] Blueprint describes adapter layer between @Agent decorator and SDK Agent.create()
- [ ] Migration plan: which files deleted, which modified, which added
- [ ] ADR: SDK as single runtime (codified as rule)

## Global DoD

- Blueprint at `knowledge-base/discoveries/blueprints/sdk-integration-blueprint.md`
- New rule written to `.claude/rules/` enforcing SDK-only runtime
