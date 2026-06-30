# Blueprint: Tool-call input surfacing (theokit#58)

## Context
theokit#58: `@theokit/agents` emits the `tool_call` StreamEvent with empty `input`/`args` (`{}`), so consumer UIs (theocode tool card) render a blank `SHELL_EXEC` card — the command the agent ran is never shown — even though the tool executes correctly. Live-evidenced on Node 24 / `theokit@0.11.6` (raw SSE `{"type":"tool_call","name":"shell_exec","args":{},"id":"…"}`). Root site: `packages/agents/src/bridge/event-translator.ts`. This blueprint resolves the exact SDK update shape that carries committed args and compares how opencode + codex surface streamed tool-call args, to lock a grounded fix strategy.

## Objective
Decide the correct, minimal emit strategy so `@theokit/agents`' `tool_call` StreamEvent carries populated `input` (not `{}`) while preserving the #42 running card and #44 chronological order, with no new dependency. Success = a chosen strategy with file:line evidence + a started→completed test plan.

## Executive summary
> **SUPERSEDED by the Empirical Correction below — read it first.** The initial static analysis (completed-patch + dedup-relaxation, ADR D1) was based on assuming the onDelta `translateInteractionUpdate` path feeds the consumer. A live `TC-DIAG` capture (Node 24, real OpenRouter tool call) proved that path is NOT used for tools; the live path is the `run.stream()` SDKMessage path (`translateToolCallEvent`, status `running`), whose args arrive **fully assembled** in field **`msg.args`** — but the bridge reads `msg.input ?? msg.arguments` (both `undefined`) → `{}`. The real fix is a **one-field correction (`msg.args`)**, not a buffering/patch architecture. See `## Empirical correction` + ADR **D2**.

(Original static hypothesis, retained for the record:) The bridge emits the `tool_call` at `tool-call-started` reading `update.toolCall.args ?? {}` (`event-translator.ts:180-188`); `partial-tool-call` is dropped (`:200-202`); assembled args were assumed to arrive only on `tool-call-completed` (mapped to `tool_result`). This led to ADR D1 (completed-patch). The live capture refuted the premise — see below.

## Empirical correction (live TC-DIAG — the decisive ground truth)
Temporary instrumentation of the installed `@theokit/agents` (logging in BOTH `translateToolCallEvent` running-branch and `translateInteractionUpdate`), run live against theocode on Node 24 with a real OpenRouter `shell_exec` tool call (`echo TCDIAG-ARGS-77`), produced:

```
[TC-DIAG] running SDKmsg keys= [ 'type','agent_id','run_id','call_id','name','status','args' ]
args= {"command":"echo TCDIAG-ARGS-77"}   input= undefined   arguments= undefined
```
and **zero** `[TC-DIAG] update …` lines (the onDelta `translateInteractionUpdate` path emitted NO tool-call events).

**Conclusions (95%+ confidence, type + runtime corroborated):**
1. The live tool_call reaches the consumer via the **`run.stream()` SDKMessage path** → `translateToolCallEvent`, status `running` (`event-translator.ts:106-109`), NOT the onDelta `tool-call-started` path. The onDelta tool-call branch is dead for this provider/config.
2. The SDKMessage `tool_call` carries the **complete** args in field **`msg.args`** (`{"command":"echo TCDIAG-ARGS-77"}`). Type-confirmed: `SDKToolUseMessage = { type:"tool_call"; call_id; …; args?: unknown }` (`node_modules/@theokit/sdk/dist/run-D22b53SU.d.ts:479-486`; comment `:472` "Emitted at start with `args`").
3. The bug: `event-translator.ts:108` reads `input: msg.input ?? msg.arguments ?? {}` — neither field exists on the SDK message; the real field is **`msg.args`** → result `{}`.

**Real fix (minimal, type-grounded, no new dependency, no dedup change):** in `translateToolCallEvent`'s `running` branch, resolve `input` from `msg.args` first — `input: msg.args ?? msg.input ?? msg.arguments ?? {}`. The `completed`/`error` branches already surface `result` correctly. The onDelta `tool-call-started` path already reads the right field (`update.toolCall.args`) and is left unchanged for providers that do use it.

## Q1 — SDK tool-call update shape + why input is `{}` (the decisive finding)

**Resolved SDK version (EC-1):** `readlink -f node_modules/@theokit/sdk` → `@theokit+sdk@2.9.0`; `package.json` `"version": "2.9.0"`. The bridge's declared peer floor is **`>=2.11.2`** (`packages/agents/package.json:39`) — the *resolved* package is **2.9.0**, **below the declared floor** (EC-1; see Q7). All type cites below are from the 2.9.0 `.d.ts`.

**The three update variants (`node_modules/@theokit/sdk/dist/types/updates.d.ts`):**
- `ToolCall` interface: `{ callId: string; name: string; args?: unknown; result?: unknown }` — args live at **`.args`** (explicitly "NOT stable") (`updates.d.ts:7-12`).
- `ToolCallStartedUpdate` = `{ type:"tool-call-started"; callId; toolCall: ToolCall; modelCallId }`, doc comment **"Tool call started — args committed."** (`updates.d.ts:40-50`).
- `PartialToolCallUpdate` = `{ type:"partial-tool-call"; callId; toolCall: ToolCall; modelCallId }`, doc comment **"Tool call arguments streaming in incrementally."** (`updates.d.ts:51-61`).
- `ToolCallCompletedUpdate` = `{ type:"tool-call-completed"; callId; toolCall: ToolCall; modelCallId }` (`updates.d.ts:62-72`).
- Exact arg field path on every variant: **`update.toolCall.args`**; result: **`update.toolCall.result`**. Union: `InteractionUpdate` (`updates.d.ts:148`).

**Emit order:** `tool-call-started` → N× `partial-tool-call` (incremental args) → `tool-call-completed` (assembled args + result). The 2.9.0 doc comment claims args "committed" at *started*, but that contradicts the existence of `partial-tool-call` ("streaming in incrementally") and the observed `{}` — real OpenAI/OpenRouter streams send tool *identity* first and JSON *argument text* across later chunks (corroborated by opencode, Q2/Q4).

**The bridge field path is CORRECT — the bug is timing + a dropped variant, not a wrong field name:**
- Live emit site is the chronological `onDelta` path `translateInteractionUpdate` (`event-translator.ts:174-203`). Its `tool-call-started` branch reads the right field — `input: update.toolCall.args ?? {}` (`event-translator.ts:180-188`). The unit test proves both halves: args present → input populated (`tests/unit/event-translator.test.ts:230-241`); args absent → `input: {}` (`event-translator.test.ts:243-252`).
- `partial-tool-call` is **intentionally dropped** — `default: return []` (`event-translator.ts:200-202`) with the comment at `event-translator.ts:172` "`partial-tool-call` is intentionally ignored (incremental args would duplicate the tool_call)". Pinned by `event-translator.test.ts:292-300`.
- `tool-call-completed` maps to `tool_result` only — never re-emits a `tool_call` with the now-assembled `update.toolCall.args` (`event-translator.ts:189-199`). The assembled args are visible to the bridge but discarded for the card.

**Which path feeds the consumer (cross-check `sdk-adapter.ts`):** Both `translateInteractionUpdate` (real-time `onDelta`) and `translateSdkEvent`→`translateToolCallEvent` (post-completion `run.stream()`) feed `mergeDeltaStream` (`sdk-adapter.ts:276-311`). The `onDelta` `tool_call` arrives first; its `callId` is recorded in `state.emittedToolCallIds` (`sdk-adapter.ts:334-336`); the `run.stream()` `tool_call` (status `running`, which reads `msg.input ?? msg.arguments ?? {}` at `event-translator.ts:108`) is then suppressed as a duplicate (`sdk-adapter.ts:256-259, 304`; `isDuplicatedByDelta`). So even though the `running`-branch attempts an alternate field (#42, `event-translator.test.ts:124-140`), it is deduped away — the empty-args `onDelta` card wins. **Root cause confirmed: args are not present on `tool-call-started` at emit time; the bridge emits the card there and drops every later variant that carries them.**

> IMPLEMENT-PHASE RISK (must verify with a live/RED test before locking the strategy): the fix assumes `tool-call-completed.toolCall.args` is populated (assembled). If completed ALSO arrives empty (args only ever in `partial-tool-call`), the fallback is opencode-style partial buffering (Q2). Verify first.

## Q2 — opencode assemble + surface mechanism
opencode buffers incremental tool-call args in a **sparse accumulator keyed by the provider's stream-local id** — `State<K> = Partial<Record<K, PendingTool>>` (`.claude/knowledge-base/references/opencode/packages/llm/src/protocols/utils/tool-stream.ts:25`, rationale `:18-24`). Each `PendingTool.input` is the **raw JSON string collected so far** (`tool-stream.ts:7-15`).
- `start()` seeds `input: ""` (`tool-stream.ts:105-109`); `appendOrStart()` concatenates arg text — `input: \`${current?.input ?? ""}${delta.text}\`` (`tool-stream.ts:117-139`); `appendExisting()` strict variant (`tool-stream.ts:146-157`).
- **Parse deferred to finalization:** `finish*()` calls `parseToolInput(route, name, input)` once, removes the entry, emits the public parsed `tool-call` (`tool-stream.ts:66-78, 164-216`). `finishWithInput` lets an authoritative final string override accumulated deltas (`tool-stream.ts:177-193`).
- **Card timing — create-early-then-patch:** `tool-input-start` on first sight (`tool-stream.ts:81-95, 52-57`), `tool-input-delta` per chunk (`:59-64`), then `tool-input-end` + parsed `tool-call` at finish (`:171-173`). The card does NOT wait for complete args.

## Q4 — opencode incremental-args tests
`.claude/knowledge-base/references/opencode/packages/llm/test/tool-stream.test.ts`:
- "starts from OpenAI-style deltas and finalizes parsed input" (`:10-37`): chunk1 `{id:"call_1",name:"lookup",text:'{"query"'}`, chunk2 `{text:':"weather"}'}` → finish → `tool-call` with assembled `input:{query:"weather"}` (`:24-35`).
- "fails appendExisting when the provider skipped the tool start" (`:39-46`): `LLMError("missing tool")` (fail-loud).
- "uses final input override without losing accumulated deltas" (`:48-65`): `finishWithInput('{"query":"final"}')` → `input:{query:"final"}`.
- "preserves providerExecuted and clears all tools" (`:67-98`): `finishAll` → per-tool assembled input, state cleared.

Takeaway: the asserted contract is **assemble-from-string-chunks then emit the parsed object at finish**.

## Q5 — codex protocol shape
codex's TS protocol models the **final assembled function call** + a **text-only delta channel**:
- `AgentMessageDeltaNotification = {threadId, turnId, itemId, delta:string}` (`.claude/knowledge-base/references/codex/codex-rs/app-server-protocol/schema/typescript/v2/AgentMessageDeltaNotification.ts:5`) — assistant TEXT delta, not tool args.
- `ResponseItem` `function_call`: `{type:"function_call", id?, name, arguments:string, call_id, ...}` — **`arguments` is a complete JSON string**, not a delta (`.claude/knowledge-base/references/codex/codex-rs/app-server-protocol/schema/typescript/ResponseItem.ts:23`).
- SDK items (`.claude/knowledge-base/references/codex/sdk/typescript/src/items.ts`): `McpToolCallItem.arguments: unknown` + `status` (`items.ts:44-72`); all carry final/aggregated payloads.

**Arg-delta facet — BLOCKED (out-of-scope Rust):** no incremental tool-arg delta type in TS. codex's TS contribution is the *shape of the terminal call* (arguments-as-complete-value), confirming "assembled args land on the completion event" — supporting the completed-patch strategy.

## Q6 — in-repo test baseline
`packages/agents/tests/unit/event-translator.test.ts` (vitest). Baseline tool_call cases:
- `translateSdkEvent`: tool_use block→tool_call (`:36-52`); completed string/object result (`:54-100`); error (`:102-122`); **status `running` #42 card** (`:124-140`).
- `translateInteractionUpdate` (#44): `tool-call-started` WITH args→populated input (`:230-241`); **WITHOUT args→`input:{}`** (bug fixture to flip) (`:243-252`); completed→tool_result (`:210-228, 254-290`); **`partial-tool-call` emits nothing** (`:292-300`).
- **Missing coverage to add:** started→partial(s)→completed sequence asserting the emitted `tool_call.input` carries the assembled args.

Test command: `npx vitest run packages/agents/tests/unit/event-translator.test.ts` (`package.json:34`) on Node 22 (`.nvmrc`).

## Q7 — dependencies
`packages/agents/package.json`: `@theokit/sdk` peerDep `>=2.11.2` (`:39`) + devDep `^2.11.2` (`:51`); `@theokit/sdk-tools` optional. Fix is **pure bridge mapping** — `translateInteractionUpdate` imports only the `InteractionUpdate` type (`event-translator.ts:8`); buffering/patching needs no new dependency and no new SDK API (`args` already on every variant). **EC-1:** installed SDK is **2.9.0** < floor **2.11.2**; the variants exist identically in 2.9.0, so type-compatible — reconcile the skew so tests validate against the floor's shape.

## Coverage Corner 1 — Integration Tests
- In-repo unit baseline: `packages/agents/tests/unit/event-translator.test.ts` (Q6) — pure-function translator tests, no SDK process.
- Boundary mocked by unit tests: the merge/dedup layer `mergeDeltaStream` + `createDeltaSink` (`packages/agents/src/bridge/sdk-adapter.ts:276-345`). A cross-update buffering/patch fix is NOT covered by per-call pure tests → needs an integration test feeding an ordered `InteractionUpdate[]` through `onDelta` and asserting the emitted `tool_call` carries assembled args AND is not wrongly suppressed by dedup (`sdk-adapter.ts:253-265`).
- opencode reference assertion shape to mirror: chunked input → finalized parsed object (`.claude/knowledge-base/references/opencode/packages/llm/test/tool-stream.test.ts:10-37`).

## Coverage Corner 2 — Dependencies
- `@theokit/sdk` peer `>=2.11.2` (`packages/agents/package.json:39`); resolved 2.9.0 (EC-1). No new dep (Q7).
- Type-only import: `InteractionUpdate` (`event-translator.ts:8`); `ToolCall` shape `{callId,name,args?,result?}` (`updates.d.ts:7-12`).
- opencode's assembler depends on `effect` + `parseToolInput` (`tool-stream.ts:1-3,66-78`) — TheoKit MUST NOT adopt `effect`; buffering (if needed) is a plain `Map<callId,…>` (Don't-Reinvent satisfied at the *pattern* level, not the lib).

## Coverage Corner 3 — Tools
- vitest `^3.2.6` (`packages/agents/package.json:57`); run `npx vitest run <file>` from repo root; Node 22 (`.nvmrc`/`engines`).
- opencode runner is `bun:test`+`effect` (`tool-stream.test.ts:1-5`) — reference only, not executable in-repo.
- No new tooling: change lives in `event-translator.ts` (+ possibly `sdk-adapter.ts` dedup) and its vitest file.

## Coverage Corner 4 — Techniques
- **Accumulate-by-id then parse-on-finish** (opencode `tool-stream.ts:25,117-139,164-175`).
- **Final-input-wins override** (opencode `finishWithInput`, `tool-stream.ts:177-193`) — directly applicable: TheoKit's `tool-call-completed` carries assembled `toolCall.args`.
- **Create-card-early, patch-later** (opencode `tool-input-start/-delta/-end`, `tool-stream.ts:52-64,81-95`) — preserves #42 while surfacing args.
- **Terminal-call-as-complete-value** (codex `ResponseItem.function_call.arguments`, `ResponseItem.ts:23`) — assembled args land on completion.
- **Per-callId dedup already present** in TheoKit (`isDuplicatedByDelta`, `sdk-adapter.ts:253-265`) — any re-emit/patch must interoperate (a naive second `tool_call` at completed is suppressed by `emittedToolCallIds`).

## Cross-cutting comparison
| Dimension | opencode | codex (TS protocol) | current @theokit/agents |
|---|---|---|---|
| Buffer strategy | Sparse `State<K>` keyed by stream-local id; raw JSON string concat (`tool-stream.ts:25,117-139`) | None in TS — Rust assembles; TS sees finished `arguments:string` (`ResponseItem.ts:23`) | **None** — each update translated in isolation; `partial-tool-call` dropped (`event-translator.ts:200-202`) |
| When args complete | Parsed once at `finish*` from accumulated string; final-input override (`tool-stream.ts:164-193`) | At `function_call` item (terminal), `arguments` complete (`ResponseItem.ts:23`) | Args present on `tool-call-completed.toolCall.args` but **discarded** for the card (mapped to tool_result, `event-translator.ts:189-199`) |
| Card timing | Create at start, stream deltas, finalize (`tool-stream.ts:52-95`) | Single terminal item | Create at `tool-call-started` with `args ?? {}` → **empty card, never patched** (`event-translator.ts:180-188`) |

## Recommendations
**Chosen: keep the early card (#42) AND patch its args from `tool-call-completed`, via the assembled `toolCall.args` the completion event already carries.**
1. Keep emitting `tool_call` at `tool-call-started` with `input: update.toolCall.args ?? {}` (preserves #42 running card + #44 chronological order — `event-translator.ts:180-188` unchanged).
2. On `tool-call-completed`, in addition to the existing `tool_result`, emit a `tool_call` carrying the assembled `update.toolCall.args` for the same `callId` (`updates.d.ts:62-72`).
3. Relax the dedup in `sdk-adapter.ts:253-265` so an **args-bearing** repeat `tool_call` for an already-seen `callId` passes as a patch (today `emittedToolCallIds` suppresses it — `sdk-adapter.ts:256-259`). Consumer renders the patched input idempotently by `callId`.

**Why over alternatives:**
- *Field-path fix alone* — rejected: `update.toolCall.args` is already correct (Q1).
- *Buffer every `partial-tool-call`* (full opencode parity) — heavier (raw-string concat + JSON parse + new spanning state); redundant because `tool-call-completed` already hands over assembled `args`. YAGNI. **(Conditional fallback if the IMPLEMENT-PHASE RISK materializes — i.e., completed.args is empty too.)**
- *Emit tool_call only at completed* — rejected: kills #42 running card + breaks #44 chronological interleave.

**Trade-off:** the chosen approach is the only one keeping BOTH the early running card (#42) and chronological order (#44) while filling args — at the cost of a second `tool_call`/patch per call + a dedup relaxation. Consumers MUST treat a repeat `tool_call` with the same `callId` as an idempotent input-update, not a new card.

## ADRs

### D2 — Read the SDKMessage `tool_call` args from `msg.args` (the real fix; supersedes D1)
- **Context:** Live `TC-DIAG` (see Empirical Correction) proves the consumer's tool_call comes from the `run.stream()` SDKMessage `running` path, whose args are complete in `msg.args` (`event-translator.ts:106-109`; type `SDKToolUseMessage.args`, `run-D22b53SU.d.ts:479-486`). The current code reads `msg.input ?? msg.arguments` (both absent) → `{}`. The onDelta path (D1's premise) is not used for tools here.
- **Decision:** Change `translateToolCallEvent` running branch to `input: msg.args ?? msg.input ?? msg.arguments ?? {}`. Leave `tool-call-started`/`tool-call-completed` onDelta branches and the `sdk-adapter.ts` dedup unchanged (no patch event, no dedup relaxation needed — the single running tool_call now carries args).
- **Alternatives considered:** D1 (completed-patch + dedup relaxation) — rejected: refuted by the live capture (the path it patches isn't the live path; it would add a second event + dedup carve-out for no benefit, violating KISS/YAGNI). Full partial-buffering — rejected (args already complete on the running message).
- **Consequences:** (+) one-line, type-grounded fix; the card fills with the real command; preserves #42 (still the same single running card) + #44 (no ordering change); no new dependency; no dedup change. (−) keeps the now-known-defunct `msg.input ?? msg.arguments` fallbacks as defensive cross-shape guards. (Risk) reconcile EC-1 SDK version skew (resolved 2.9.0 < peer floor 2.11.2). (Test) RED unit test: `translateToolCallEvent` / `translateSdkEvent` running message with `args` populated → emitted `tool_call.input` equals the args; plus a live smoke (tool card shows the command).

### D1 — [SUPERSEDED by D2] Surface tool-call args via a completed-event patch, not partial buffering
- **Context:** SDK 2.9.0 emits `tool-call-started` with empty `args` (despite the "args committed" doc comment, `updates.d.ts:40-50`); assembled args arrive on `tool-call-completed.toolCall.args` (`updates.d.ts:62-72`); the bridge drops `partial-tool-call` (`event-translator.ts:200-202`) and maps completed→tool_result only (`event-translator.ts:189-199`), so the card stays `{}`.
- **Decision:** On `tool-call-completed`, emit an args-bearing `tool_call` patch for the same `callId` (in addition to `tool_result`), and relax `isDuplicatedByDelta` (`sdk-adapter.ts:253-265`) to let an args-bearing repeat through. Keep the `tool-call-started` early card unchanged.
- **Alternatives considered:** (a) full opencode-style `partial-tool-call` accumulation (`tool-stream.ts:25,164-193`) — rejected as redundant given completed carries assembled args (KISS/YAGNI); kept as conditional fallback. (b) emit only at completed — rejected (breaks #42 + #44). (c) change field path — rejected (path already correct).
- **Consequences:** (+) card fills with real args while preserving #42/#44; (+) no new dependency (Q7); (−) two `tool_call`-shaped events per call + a dedup carve-out → consumers treat a same-`callId` repeat as an idempotent input patch; (−) args appear at completion latency, not keystroke-incremental (acceptable: a blank card is the bug, not lack of per-token arg streaming). (Risk) reconcile EC-1 SDK version skew; add the missing started→partial→completed integration test (Q6, Corner 1); **VERIFY completed.args is populated before locking (IMPLEMENT-PHASE RISK in Q1).**
