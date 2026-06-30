---
"@theokit/agents": patch
---

Fix `tool_call` StreamEvent surfacing an empty `input` (`{}`), which blanked consumer tool cards (theokit#58).

`event-translator.ts`'s `translateToolCallEvent` read the running tool message's args from `msg.input ?? msg.arguments`, but the real `@theokit/sdk` `SDKToolUseMessage` field is `args` (`run-D22b53SU.d.ts:486`) — both read fields were `undefined`, so `input` fell back to `{}` and the UI tool card showed no command (e.g. a blank `SHELL_EXEC`), even though the tool executed correctly. Confirmed empirically (live Node 24 + OpenRouter: `msg.args={"command":…}`, `input`/`arguments` undefined) and by the SDK type.

The fix reads `msg.args` first — `input: msg.args ?? msg.input ?? msg.arguments ?? {}` — keeping the legacy fields as defensive cross-shape fallbacks. No new dependency, no dedup change, no behavior change for the `tool-call-started` onDelta path (already reads the correct field). Covered by 3 unit tests + 2 integration tests.
