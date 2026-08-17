# Blueprint: Leaked-dialect safe-parse — feasibility (NO-GO in @theokit/agents)

## Context
Enhancement request: when `qwen3-coder` leaks the Hermes `<function=…></tool_call>` dialect as assistant TEXT (theocode#32), instead of STRIPPING it (current `tool-dialect-stripper.ts`), **safe-parse it back into a tool call so the tool actually executes** — now that theokit#53's `no_progress` guard exists to prevent the parse-induced spin. This blueprint determines feasibility BEFORE any code, because the request overturns a LOCKED decision (#32: strip-not-parse).

## Objective
Decide whether safe-parse-AND-EXECUTE is buildable framework-first in `@theokit/agents`, and if not, name the correct layer.

## Q1 — Who owns tool execution? (the crux)
`@theokit/agents` compiles `@Tool`s and passes them to `Agent.create({ tools })`; the SDK runs the loop via `Run.stream()` and executes tools from the model's **native** `tool_calls` (`packages/agents/src/bridge/sdk-adapter.ts:7,375-387`; SDK `run-D22b53SU.d.ts:823 tools?: CustomTool[]`). `stripToolDialect` is a **display-stream** transform over `text_delta` (`packages/agents/src/bridge/tool-dialect-stripper.ts` header). **When the model leaks the dialect as text, the SDK never sees a `tool_call` → the tool never executes.** The bridge consumes stream OUTPUT; it cannot inject a tool call back into the SDK loop.

## Q2 — Does the SDK expose a hook to inject an executable tool call from content?
SDK plugin hook system (`@theokit/sdk@2.9.0` `dist/internal/plugins/types.d.ts`):
- `HookName = pre_tool_call | post_tool_call | pre_llm_call | post_llm_call | on_session_start | on_session_end | transform_tool_result | transform_llm_output | pre_user_send | post_assistant_reply`.
- `transform_llm_output` **exists in the enum but has NO typed/documented contract** — `HookHandler = (ctx: unknown) => unknown`. The only typed contexts are `PreToolCallContext`, `PreUserSendContext`, `PostAssistantReplyContext`. There is NO hook result type carrying `ToolUseBlock[]`/`tool_calls`.
- The only injection primitive in `PluginContext` is `injectMessage(content, role?: 'user'|'system')` — injects **text**, NOT a tool call, and "v1 supports only `on_session_start` context".
- ⇒ There is **no public, typed SDK surface to convert leaked content into an executed tool call.** Building on the untyped `transform_llm_output` would rely on undocumented internals (fragile, breaks on SDK updates) — a workaround, not a sanctioned extension.

## Q3 — Prior art (how peers do parse-and-execute)
ai-sdk does content→tool-call extraction via **provider middleware** (`extract-*-middleware`); opencode assembles tool args in its **llm/protocol** layer (`tool-stream.ts`). In every case the parse-and-execute happens at the **provider/response-parsing layer that feeds the loop**, NOT in a downstream display transform. The analogous home in this ecosystem is `@theokit/sdk` (provider/`defineProvider`/response handling), not `@theokit/agents`.

## Coverage Corner 1 — Integration Tests
A real safe-parse-execute would need an integration test asserting a leaked-dialect turn results in an EXECUTED tool (tool_result present). That test is unwritable in `@theokit/agents` because the bridge cannot drive execution — confirming the layer mismatch.

## Coverage Corner 2 — Dependencies
No dependency unlocks this in the bridge; the gap is an SDK capability (a public output-transform-with-tool-injection hook OR a provider middleware), which would ship in `@theokit/sdk`.

## Coverage Corner 3 — Tools
N/A — no tooling change makes a display-layer transform own execution.

## Coverage Corner 4 — Techniques
Correct technique (provider/response middleware that extracts tool calls from content before the loop decides) is an SDK-layer technique. The `no_progress` guard (#53) handles the spin risk, but the spin was never the blocker — execution ownership is.

## ADRs

### D1 — NO-GO: do not implement safe-parse in @theokit/agents
- **Context:** Q1/Q2 — the bridge can't execute; the SDK exposes no typed hook to inject executable tool_calls.
- **Decision:** Do NOT build leaked-dialect safe-parse-and-execute in `@theokit/agents`. The #32 LOCKED strip-not-parse decision stands for the bridge/display layer. A display-only parse (card without execution) is rejected — it would lie (G10) and is a workaround the requester forbade.
- **Alternatives (correct paths, for the human to choose):**
  1. **`@theokit/sdk` provider middleware** (correct layer): a provider/response transform that extracts Hermes tool calls from content → native `tool_calls` before the loop's decision. Run the cycle in the `theokit-sdk` repo. Mirrors ai-sdk's `extract-*-middleware`.
  2. **Config mitigation** (zero framework change): route to a model/provider that emits native `tool_calls` reliably (the leak is `qwen3-coder`-via-OpenRouter-specific), or pin a provider profile.
  3. **Status quo:** keep #32 strip; the leak is intermittent, #53 prevents the spin, native tool calls work (proven: theokit#58 live).
- **Consequences:** no merge in this repo; the request is redirected to the SDK or to config. Honest BLOCKED > a fragile parse-on-undocumented-internals (no rework / no workaround).

## Verdict
**BLOCKED (NO-GO in @theokit/agents).** The cycle terminates at discovery with an evidence-based feasibility verdict: the enhancement belongs in `@theokit/sdk` (provider/response middleware) or is a config mitigation — not a `@theokit/agents` change. No READY_TO_MERGE is honestly achievable in this repo without a layering violation / workaround.
