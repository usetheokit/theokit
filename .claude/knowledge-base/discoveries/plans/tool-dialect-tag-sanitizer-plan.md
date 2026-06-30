# Discovery Plan: Tool-Dialect Tag Sanitizer — strip leaked Hermes `<function=…>` from assistant text

> **Version 1.1** — investigate how to neutralize a model leaking its tool-call dialect (Hermes-style `<function=name>…</function></tool_call>` XML) into the assistant TEXT stream, building on `@theokit/agents`' existing `think-tag-extractor` pattern. Output: a blueprint that locks STRIP-vs-PARSE, opt-in-vs-always-on, and the transform shape for the theocode#32 fix (framework-first in `@theokit/agents`; theocode adopts).
>
> **v1.1 changelog** (absorbed from `reviews/tool-dialect-tag-sanitizer-edge-cases-2026-06-30.md`): EC-1 (MUST FIX) — Q2 repointed from the thin route re-export `openai-compatible-chat.ts` (876 bytes, 0 tool-call matches) to `openai-chat.ts` (the file that actually holds the tool-call mapping, 46 matches). EC-2/EC-3 (SHOULD TEST) — added halt-loop checkpoints for the Q4 grep-broadening and the transform.ts Read range bound.

**Slug:** `tool-dialect-tag-sanitizer`
**Owner:** usetheodev
**Created:** 2026-06-30
**Time budget:** 1.5h (opencode 1.0h, codex 0.5h)

## Context

theocode#32 (live-reproduced): `qwen/qwen3-coder-30b-a3b-instruct` intermittently emits its tool-call dialect as assistant CONTENT — `<function=write_file><parameter=path>…</parameter></function></tool_call>` — instead of native OpenAI `tool_calls` (round 1 used native tool_calls; round 2 leaked the XML). The OpenAI/OpenRouter path expects JSON `tool_calls`, so the XML is passed through as `text_delta` and rendered verbatim in the answer. `@theokit/agents` already ships the EXACT pattern for this model class: `bridge/think-tag-extractor.ts` neutralizes inline `<think>` dialect tags from the assistant text stream (its docstring names qwen3-coder/deepseek), opt-in via `parseThinkTags`, wired into `createSdkAgentStream` (`sdk-adapter.ts:497`). The `<function=…>` leak is the SAME class (a dialect tag in the text stream from the same model class). This discovery locks the design before code, framework-first. Governing rules: `rules/architecture.md` (loop/bridge boundary), `rules/system-design-guardrails.md` G10 (honest enforcement — never silently render a leaked tool dialect as answer), `rules/testing.md` (deterministic incremental-splitter tests).

## Objective

Decide STRIP vs PARSE, opt-in vs always-on, and the transform shape for neutralizing leaked Hermes tool-call XML, grounded in ≥2 references + the in-repo precedent. Success criteria for the blueprint:

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison (opencode sanitize/normalize vs codex native-contract vs in-repo think-tag) populated
- [ ] ≥1 concrete decision proposal per research question (strip/parse, opt-in, transform shape)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/opencode/` | `packages/opencode/src/provider/transform.ts`, `packages/llm/src/protocols/` | opencode sanitizes/normalizes message content in a transform layer (`sanitizeSurrogates`/`normalizeMessages`) and normalizes tool-calls per protocol — the "clean content in a bridge transform" precedent |
| `.claude/knowledge-base/references/codex/` | `codex-rs/protocol/src/openai_models.rs` | codex's native OpenAI tool-call protocol shape — establishes the contract a well-behaved model meets (the leak is the deviation) |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/opencode/packages/{ui,app,desktop}/` | Render/UI — the fix is in the stream transform, not the renderer |
| `.claude/knowledge-base/references/{astro,fastify,hono,next.js,nitro,workers-sdk}/` | Web frameworks — no LLM tool-call dialect handling |
| `.claude/knowledge-base/references/{nemo-guardrails,openguardrails-agentfw}/` | Guardrails/safety — not tool-call-dialect parsing |
| cline / aider / ai-sdk | NOT cloned into theokit's `knowledge-base/references/` (they live in theocode's). The in-repo `think-tag-extractor.ts` — which itself cites Aider `reasoning_tags.py` + Vercel AI SDK `extract-reasoning-middleware.ts` — is the authoritative pattern and is cited as in-repo `file:line`, not as a reference |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** opencode 1.0h (primary — has the content-sanitization transform + per-protocol tool-call normalization), codex 0.5h (secondary — the native-tool_call contract the leak deviates from).

**Rationale:** the authoritative pattern is IN-REPO (`think-tag-extractor.ts`) — the framework already neutralizes a dialect tag for this exact model class. The references corroborate the "sanitize/normalize in a bridge transform" approach (opencode) and the "native tool_calls is the contract" baseline (codex). Two references + the in-repo precedent satisfy the ≥2-reference rule.

**Stop condition — per question:** Fase A empty after 3 query-variant retries → BLOCKED ("Fase A exhausted"), continue. **Per project:** budget exhausted → remaining BLOCKED ("budget exhausted"). Never fabricate a Fase B answer (Unbreakable Rule 3).

**Consequences:** halt-loop stops on budget; blocked questions surface in the blueprint.

### D2 — Investigation depth

**Decision:** Read each hotspot end-to-end (the sanitizer/transform function + its call-site/wiring + its test). Grep to locate; Read to capture intent + shape.

**Rationale:** the fix hinges on (a) WHAT to do with leaked dialect (strip vs parse), (b) WHERE it plugs into the stream (the createSdkAgentStream wiring), (c) the incremental-splitter shape (tag straddling a chunk boundary). All three need surrounding code.

**Consequences:** narrow but deep.

### D3 — Dependencies corner is in-scope, not deferred

**Decision:** Keep a real Dependencies question (Q5).

**Rationale:** the fix must add NO dependency (Unbreakable Rule 9 / KISS) — `think-tag-extractor` is pure string logic; confirming opencode's sanitizer is also stdlib-string locks "no new dep" into the plan.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep/ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | When a model emits malformed/dialect content, does opencode STRIP/sanitize it or try to PARSE/salvage it? | techniques | `.claude/knowledge-base/references/opencode/packages/opencode/src/provider/transform.ts` | `grep -n "sanitize\|normalize\|replace\|strip" transform.ts` (hotspots: `:25` sanitizeSurrogates, `:65` normalizeMessages, `:432` call-site) | Read `transform.ts:25-120` — capture whether content is dropped/replaced (strip) or reconstructed (parse), and at which boundary | Prose: "strips via X" vs "parses via Y" + `transform.ts:line` |
| Q2 | How does opencode normalize tool calls per provider protocol (is native tool_calls the contract, with text-dialect being out-of-contract)? | techniques | `.claude/knowledge-base/references/opencode/packages/llm/src/protocols/openai-chat.ts` (the protocol the OpenAI-compatible route reuses end-to-end via `OpenAIChat.protocol`; `openai-compatible-chat.ts` is only a thin route re-export with no mapping) | `grep -n "tool_call\|toolCall\|ToolCall" openai-chat.ts` (hotspots: `:74` assistant `tool_calls` schema, `:146` `OpenAIChatToolCallDelta`, `:234`/`:247`/`:254` the `lowerToolCall` accumulator) | Read the tool-call mapping — confirm native JSON tool_calls is the parsed contract (text dialect is not a tool-call path) | Confirmation + `:line` that native tool_calls is the contract |
| Q3 | WHERE does opencode apply the content sanitizer in the message pipeline (so the in-repo analog knows its plug point)? | tools | `.claude/knowledge-base/references/opencode/packages/opencode/src/provider/transform.ts` | `grep -n "normalizeMessages(\|return msgs\|sanitize" transform.ts` (hotspot `:432` call-site) | Read the call-site — capture where in the request/response transform the sanitizer runs | Pipeline position + `:line` |
| Q4 | What does codex treat as a tool call (the native protocol shape) — confirming the leak is a model deviation, not a supported text path? | tests | `.claude/knowledge-base/references/codex/codex-rs/protocol/src/openai_models.rs` | `grep -n "tool\|function\|FunctionCall\|ToolCall" openai_models.rs` | Read the tool-call struct/enum — confirm structured (JSON) tool calls, no text-dialect parsing | The native tool-call type + `:line` |
| Q5 | Does opencode's content sanitizer pull any dependency, or pure stdlib string ops? | deps | `.claude/knowledge-base/references/opencode/packages/opencode/src/provider/transform.ts` | `grep -n "import\|require\|\.replace(\|RegExp" transform.ts` (head) | Read the imports + the sanitizer body | "stdlib string/regex only" OR a named dep, with `:line` |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q5 | Covered |
| Tools | Q3 | Covered |
| Techniques | Q1, Q2 | Covered |

**Coverage: 4/4 corners covered (100%)**

> Note: the corner "Integration tests" is satisfied by Q4 against codex's protocol contract; the in-repo TEST pattern to mirror (`packages/agents/tests/unit/think-tag-extractor.test.ts` + `tests/integration/sdk-adapter-think-tags.test.ts`) is in-repo evidence the blueprint cites directly (not a `references/` path), and drives the implementation's test design.

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | the cited `.claude/knowledge-base/references/{...}` path exists | Mark Qx BLOCKED ("path not found"), continue |
| Per-question Fase A | ≥1 hotspot OR 3 retries | After 3 empty → BLOCKED ("Fase A exhausted"), continue |
| Q4 grep breadth (EC-2) | narrow grep `FunctionCall\|ToolCall` yields ≥1 STRUCTURED tool hit | If only config-type hits (`ToolMode`/`supports_parallel_tool_calls`), broaden to `Tool\|tool` and confirm structured (JSON, non-text) representation BEFORE marking done — do NOT BLOCK on the narrow pattern alone |
| Q1/Q3/Q5 Read scope (EC-3) | each Read bounded to the hotspot function range, NOT the whole 1543-line `transform.ts` | Bound to `sanitizeSurrogates` `:25-30`, `normalizeMessages` `:65-130`, call-site `:432` — a literal full-file Read ×3 would exhaust the 1.0h opencode budget before Q4 (codex) runs |
| After answering Qx | Blueprint section under Qx has ≥1 citation | Re-iterate Qx (1 retry max) |
| Per-project budget | not exhausted | When exhausted → remaining Qx BLOCKED ("budget exhausted") |
| Before promise | all 4 corners populated + a strip-vs-parse ADR drafted | Refuse promise, continue |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly BLOCKED with reason
- [ ] All four coverage corners populated in the blueprint
- [ ] Every citation points to a real `.claude/knowledge-base/references/{...}` path (in-repo `packages/...` citations allowed for the think-tag precedent)
- [ ] ≥1 ADR synthesizing strip-vs-parse + opt-in-vs-always-on + transform shape
- [ ] Time budget respected
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/tool-dialect-tag-sanitizer-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → plan-confidence → execute → confidence → improve if needed)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference ≥1 project principle/rule (Unbreakable Rule 9 / KISS for no-new-dep; `architecture.md` for the bridge-transform boundary; `system-design-guardrails.md` G10 for never silently rendering a leaked dialect)
