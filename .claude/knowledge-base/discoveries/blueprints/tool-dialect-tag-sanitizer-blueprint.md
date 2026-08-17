# Blueprint: Tool-Dialect Tag Sanitizer — neutralize leaked Hermes `<function=…>` in assistant text

> **Version 1.0** — synthesizes how to neutralize a model that leaks its tool-call dialect (Hermes-style `<function=name><parameter=k>v</parameter></function></tool_call>` XML) into the assistant TEXT stream, for the theocode#32 framework-first fix in `@theokit/agents`. Investigated: **opencode** (content-sanitization transform + per-protocol tool-call lowering) and **codex** (structured tool-call protocol contract), plus the in-repo `think-tag-extractor.ts` precedent (the framework already neutralizes a dialect tag for this exact qwen/deepseek model class). Locks STRIP-vs-PARSE, opt-in-vs-always-on, and the transform shape.

**Slug:** `tool-dialect-tag-sanitizer`
**Source plan:** `.claude/knowledge-base/discoveries/plans/tool-dialect-tag-sanitizer-plan.md` (v1.1)
**Owner:** usetheodev
**Generated:** 2026-06-30 via `/discover-execute` (inline per-iteration contract; bounded 5-question investigation)
**Confidence verdict:** SHIPPABLE_WITH_CAVEATS (89) — `/discover-confidence` 2026-06-30

## Context

theocode#32 (live-reproduced): `qwen/qwen3-coder-30b-a3b-instruct` intermittently emits its tool-call dialect as assistant CONTENT — `<function=write_file><parameter=path>…</parameter></function></tool_call>` — instead of native OpenAI `tool_calls` (round 1 used native tool_calls; round 2 leaked the XML as `text_delta`). The OpenAI/OpenRouter path passes that text through verbatim, rendering raw XML in the visible answer. `@theokit/agents` already ships the EXACT pattern for this model class: `bridge/think-tag-extractor.ts` neutralizes inline `<think>` dialect tags from the assistant text stream, opt-in via `parseThinkTags`, wired into `createSdkAgentStream` (`sdk-adapter.ts:497`). The `<function=…>` leak is the SAME class — a dialect tag in the text stream from the same model family.

## Objective

Decide whether to **STRIP** (neutralize the leaked dialect) or **PARSE** (salvage it into a tool call), whether the transform is **opt-in** or **always-on**, and the **transform shape**, grounded in the two references + the in-repo precedent.

---

## Coverage Corner 1 — Integration Tests

> The TEST pattern the implementation must mirror is in-repo, cited at the end of this corner. The reference (codex) supplies the **contract** that the test asserts against: a well-behaved model expresses tools structurally, never as text.

### codex — the structured tool-call protocol contract (Q4)

codex defines every tool capability as a strongly-typed, JSON-Schema-derived enum/struct — never a text dialect to be parsed out of content:

- `ConfigShellToolType` enum (`Default`/`Local`/`UnifiedExec`/`Disabled`/`ShellCommand`) — `.claude/knowledge-base/references/codex/codex-rs/protocol/src/openai_models.rs:265`
- `ApplyPatchToolType` enum — `…/openai_models.rs:275`
- `WebSearchToolType` enum (`Text`/`TextAndImage`) — `…/openai_models.rs:283`
- `ToolMode` enum (`Direct`/`CodeMode`/`CodeModeOnly`) — `…/openai_models.rs:299`
- `supports_parallel_tool_calls: bool` model-config field — `…/openai_models.rs:379`

Every one carries `#[derive(Serialize, Deserialize, JsonSchema)]` — tools are a **structured protocol concern**, settled at config/schema time. There is no code path in codex that parses a tool call out of free assistant text. **This confirms the theocode#32 leak is a model DEVIATION from the contract, not a supported text path** — which is the linchpin for the STRIP-not-PARSE decision (ADR D1).

### In-repo TEST pattern to mirror (the implementation's test design)

The new sanitizer's tests mirror the think-tag suite (in-repo evidence, not a `references/` path):

- `packages/agents/tests/unit/think-tag-extractor.test.ts` — the incremental-splitter unit tests (chunk-straddle, truncated tag flush).
- `packages/agents/tests/integration/sdk-adapter-think-tags.test.ts` — opt-in wiring (transform applied only when the flag is set; passthrough otherwise).

These prove the deterministic-splitter shape (Corner 4 / ADR D3) and the opt-in wiring (ADR D2).

---

## Coverage Corner 2 — Dependencies

### opencode — the content sanitizer is pure stdlib string ops (Q5)

`sanitizeSurrogates` is a single native `String.prototype.replace` with a regex literal — **no dependency**:

```ts
// .claude/knowledge-base/references/opencode/packages/opencode/src/provider/transform.ts:25
export function sanitizeSurrogates(content: string) {
  return content.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�")
}
```

`transform.ts` does import `remeda` (`mergeDeep`/`unique`) and `ai`/`@ai-sdk/provider` types at the top (`…/transform.ts:1-6`), but the **sanitizer body itself touches none of them** — it is stdlib `.replace` + a `RegExp` literal. This corroborates the in-repo precedent: `think-tag-extractor.ts` is likewise pure string logic with zero imports beyond a `StreamEvent` type (`packages/agents/src/bridge/think-tag-extractor.ts:18`). **The theocode#32 fix adds NO new dependency** (Unbreakable Rule 9 / KISS — ADR-anchored in plan D3).

| Dependency | Needed for the sanitizer? | Citation |
|---|---|---|
| (none — native `String.replace` + `RegExp`) | the sanitizer body is stdlib-only | `transform.ts:25-27` |
| `remeda` | used elsewhere in `transform.ts`, NOT by the sanitizer | `transform.ts:2` |

---

## Coverage Corner 3 — Tools

### opencode — WHERE the sanitizer plugs into the message pipeline (Q3)

opencode applies content sanitization inside `normalizeMessages`, a transform that walks every message by role and rewrites `text`/`reasoning`/tool-result content in place:

- `normalizeMessages(msgs, model, options)` — the transform function, `.claude/knowledge-base/references/opencode/packages/opencode/src/provider/transform.ts:65`
- Per-role rewrite: `system` (`:98`), `user` (`:103`/`:107`), `assistant` (`:115`/`:120` — text + reasoning), `tool` results (`:91`/`:123`) — each routes through `sanitizeSurrogates`.
- **Call-site** (where it runs in the request transform): `msgs = normalizeMessages(msgs, model, options)` — `transform.ts:432`.

The plug point is a **message-content transform in the provider bridge layer**, applied to the assistant text content as the messages flow through. The in-repo analog plugs at the equivalent seam: `createSdkAgentStream` applies the `text_delta` transform when `parseThinkTags` is set — `packages/agents/src/bridge/sdk-adapter.ts:497`. **The `<function=…>` sanitizer plugs at the SAME seam as `extractThinkTagStream`** (the stream transform over `text_delta`), not in a renderer (ADR D3).

> Shape difference worth noting: opencode sanitizes the **message array** (request/turn boundary), whereas the in-repo think-tag transform sanitizes the **streaming `text_delta` events** (token boundary). The theocode#32 leak arrives as `text_delta`, so the in-repo stream-transform seam is the correct one (a streaming model leaks incrementally; the tag can straddle chunks — Corner 4).

---

## Coverage Corner 4 — Techniques

### Technique 1 — STRIP vs PARSE: opencode strips, never re-parses (Q1)

When opencode encounters malformed/out-of-contract content, it **neutralizes** it (replaces the offending bytes with the U+FFFD replacement char via `sanitizeSurrogates`) — it does NOT attempt to reconstruct meaning from it:

| Project | STRIP or PARSE? | Approach | Citation |
|---|---|---|---|
| opencode | **STRIP** | malformed surrogate bytes → replaced with `�`; content is neutralized, never salvaged into structure | `transform.ts:25-27` |
| in-repo think-tag | **EXTRACT-then-reclassify** (a STRIP variant) | inline `<think>…</think>` is removed from the text channel and re-emitted as a separate `thinking` segment — the text channel is cleaned, the content is re-routed, never parsed into a structured tool call | `think-tag-extractor.ts:62-93` |

The think-tag precedent is the precise analog: it does NOT parse `<think>` into a native reasoning API call — it splits the dialect tag out of the visible text and re-routes it to the correct channel. For `<function=…>`, the equivalent is: **strip the leaked XML out of the visible answer** (and, optionally, surface it as a non-answer diagnostic segment) — **do NOT re-parse it into a `tool_call`**.

### Technique 2 — native `tool_calls` is the parsed contract; text dialect is out-of-contract (Q2)

opencode parses tool calls EXCLUSIVELY from the structured `tool_calls` JSON field, never from assistant text:

- Assistant message schema carries `tool_calls: optionalArray(OpenAIChatAssistantToolCall)` as a **structured field** — `.claude/knowledge-base/references/opencode/packages/llm/src/protocols/openai-chat.ts:74`
- Streaming tool calls arrive as a typed delta `OpenAIChatToolCallDelta` (`index`/`id`/`function`) — `…/openai-chat.ts:136-147`
- The accumulator collects tool calls only from the structured `tool-call` content part: `lowerToolCall(part)` pushed into `toolCalls[]`, emitted as `tool_calls` — `…/openai-chat.ts:234`/`:247`/`:254`
- A tool call is lowered to `{ id, type: "function", function: { name, arguments } }` — `…/openai-chat.ts:194-201`

There is **no path** that reads a `<function=…>` dialect out of `content`. Assistant `content` is `Schema.NullOr(Schema.String)` (`…/openai-chat.ts:73`) — free text, never a tool-call source. **This is the decisive evidence: native `tool_calls` is the contract; the `<function=…>` text is the model breaking contract** → strip it from the answer rather than honor a broken channel.

### Technique 3 — incremental splitter (tag straddling a chunk boundary) — in-repo precedent

The transform must handle a dialect tag split across two streaming chunks. The in-repo `createThinkTagExtractor` solves this with a `heldPrefixLength` buffer: it emits all resolved text but holds back any trailing substring that could still grow into the delimiter on the next chunk (`think-tag-extractor.ts:38-44`, `:62-93`), and flushes a truncated/unclosed tag on `end()` so nothing is silently dropped (`:86-91`, `:127-129`, honoring Unbreakable Rule 8). **The `<function=…>` sanitizer reuses this exact incremental-splitter shape** — the only delta is the delimiter set (a `<function=` open + its `</function></tool_call>` close, vs `<think>`/`</think>`).

---

## Cross-cutting Comparison

| Dimension | opencode | codex | in-repo (`think-tag-extractor`) |
|---|---|---|---|
| Malformed/dialect content | STRIP (`�` replace) `transform.ts:25` | n/a — never accepts text-dialect tools | EXTRACT + re-route `think-tag-extractor.ts:62` |
| Tool-call source | structured `tool_calls` only `openai-chat.ts:74` | structured enums/schema `openai_models.rs:265-379` | n/a (reasoning, not tools) |
| Plug point | message-array transform `transform.ts:432` | protocol/schema layer | streaming `text_delta` transform `sdk-adapter.ts:497` |
| Dependencies | stdlib `.replace` `transform.ts:25` | Rust serde/JsonSchema derives | zero (StreamEvent type only) `think-tag-extractor.ts:18` |
| Opt-in? | always-on (surrogate safety is universal) | n/a | opt-in via `parseThinkTags` `sdk-adapter.ts:497` |

## ADRs

### D1 — STRIP the leaked dialect; never PARSE it into a tool call

**Decision:** The transform STRIPS the leaked `<function=…></tool_call>` XML out of the assistant text channel (neutralizing it so it never renders as the answer). It does NOT parse the XML back into a native `tool_call`.

**Rationale:** Both references converge: opencode treats out-of-contract content by neutralizing it (`transform.ts:25`), never salvaging; and native `tool_calls` is the sole parsed tool-call contract (`openai-chat.ts:74`, `openai_models.rs:265-379`). The in-repo think-tag precedent does exactly this for `<think>` — extract from the text channel, re-route, never parse into a structured API call (`think-tag-extractor.ts:62-93`). Parsing the leaked XML back into a tool call would (a) re-introduce the spin theokit#53 just fixed (a re-parsed call the loop would re-run), and (b) trust a channel the provider already broke.

**Alternatives considered:** _PARSE/salvage the XML into a synthetic `tool_call`_ — rejected: re-honors a broken channel, risks malformed-args injection, and the loop has no signature guarantee for a salvaged call (theokit#53 spin risk). _Render-time strip in the UI_ — rejected: the renderer is out-of-scope (plan); the leak must die at the stream transform so every consumer (CLI, desktop, logs) benefits (mirrors `sdk-adapter.ts:497`, not a renderer).

**Consequences:** The visible answer is clean; a leaked tool intent is dropped (the model simply failed to call the tool that round — the loop continues honestly, no phantom execution). Optionally the stripped XML can be surfaced as a diagnostic segment (non-answer), mirroring how think-tags re-route to a `thinking` segment — deferred to implementation as a nice-to-have, not required for the fix.

### D2 — Opt-in via a flag (sibling to `parseThinkTags`), default OFF

**Decision:** The sanitizer is opt-in via a new run option (sibling to `parseThinkTags`), default off; wired into `createSdkAgentStream` the same way.

**Rationale:** A code assistant can legitimately emit a literal `<function=…>` inside answer/code text (e.g., explaining Hermes format, or generating code that contains that string). Always-on stripping would corrupt legitimate content. The think-tag precedent made the identical call for the identical reason — "a code assistant can legitimately emit literal `<think>` in answer/code text" (`think-tag-extractor.ts:12-13`), default off. Symmetry with `parseThinkTags` keeps the framework surface coherent.

**Alternatives considered:** _Always-on_ (like opencode's `sanitizeSurrogates`, which is universal) — rejected: surrogate-pair repair is genuinely universal (invalid Unicode is never legitimate), but a `<function=…>` substring CAN be legitimate text, so the two are not analogous. _Auto-enable per-model (qwen/deepseek allowlist)_ — rejected as premature (YAGNI); a flag is simpler and the consumer (theocode) knows its model.

**Consequences:** theocode opts in for the qwen/qwen3-coder path to close #32; other consumers are unaffected by default. One new run-option + wiring line, mirroring the existing `parseThinkTags` plumbing.

### D3 — Reuse the incremental-splitter transform shape; add NO dependency

**Decision:** Implement as a `StreamEvent` transform over `text_delta` (a sibling to `extractThinkTagStream`), built on the same `createThinkTagExtractor`-style incremental splitter with a held-prefix buffer for chunk-straddle, flushing on `end()`. Pure string logic, zero new dependency.

**Rationale:** The leak arrives as streaming `text_delta` and a multi-char delimiter (`<function=` … `</tool_call>`) can straddle chunk boundaries — exactly the problem `heldPrefixLength` solves (`think-tag-extractor.ts:38-44`). opencode confirms the sanitizer is stdlib `.replace` with no dep (`transform.ts:25`); the in-repo splitter is likewise zero-dep (`think-tag-extractor.ts:18`). Reuse the proven shape; generalize the delimiter rather than re-inventing.

**Alternatives considered:** _Message-array transform (opencode `normalizeMessages` shape, `transform.ts:432`)_ — rejected for this leak: it operates at the turn boundary, but the leak must be neutralized incrementally as `text_delta` streams (otherwise raw XML flashes in the live UI before the turn completes). _Single regex `.replace` over the accumulated text_ — rejected: cannot handle the streaming/straddle case without buffering the whole turn (defeats streaming UX). The held-prefix incremental splitter is the minimum that works for a streamed multi-char delimiter.

## Recommendations for the project

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Add `createToolDialectStripper` (incremental splitter, held-prefix buffer for the `<function=…></tool_call>` delimiter) + `stripToolDialectStream` (StreamEvent transform over `text_delta`), as a sibling module to `think-tag-extractor.ts`. Pure string logic, no new dep. | Q1, Q3, D1, D3; `parsimony-ladder.md`; G8 (web-standards stream transform) | HIGH |
| 2 | Wire it opt-in into `createSdkAgentStream` (new run option, default off), mirroring the `parseThinkTags` resolution + `:497` wiring. | Q2, D2; `architecture.md` (bridge boundary); G10 (honest enforcement — never silently render a leaked dialect) | HIGH |
| 3 | Mirror the think-tag test suite: unit tests for the incremental splitter (chunk-straddle, truncated/unclosed tag flush, legitimate `<function` substring NOT stripped when flag off) + integration test for opt-in wiring (transform applied iff flag set; passthrough otherwise). | Q4, D2, D3; `testing.md` §3 (TDD), §4.1 (edge + negative) | HIGH |
| 4 | theocode adopts the bumped `@theokit/agents` (enable the flag on the qwen/qwen3-coder path) to close theocode#32. | D2; framework-first thesis | HIGH |

## Blocked questions (if any)

(none — all 5 research questions answered with verified citations)

## Halt-loop progress (audit trail)

- Iterations used: inline per-iteration contract (bounded 5-question investigation; ralph-loop overhead waived per `loop-engine-convention.md` — deterministic, all anchors pre-verified in `/discover-edge-cases`)
- Questions answered: 5 / 5
- Questions blocked: 0
- Citations verified: all (post-write sanity check below)
- Promise: BLUEPRINT_COMPLETE (all four corners populated, ≥1 ADR — 3 ADRs present, every citation resolves)

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/tool-dialect-tag-sanitizer-plan.md` (v1.1)
- Edge-case review: `.claude/knowledge-base/reviews/tool-dialect-tag-sanitizer-edge-cases-2026-06-30.md`
- Plan-gate: `.claude/knowledge-base/reviews/tool-dialect-tag-sanitizer-discover-plan-confidence-2026-06-30.md` (SHIPPABLE_WITH_CAVEATS 89)
- In-repo precedent: `packages/agents/src/bridge/think-tag-extractor.ts`, `packages/agents/src/bridge/sdk-adapter.ts:497`
- Project rules: `.claude/rules/architecture.md` (bridge boundary), `.claude/rules/system-design-guardrails.md` G10 (honest enforcement), `.claude/rules/testing.md`, `.claude/rules/parsimony-ladder.md` (no new dep)
- Closes: theocode#32 (framework-first)
