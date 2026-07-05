---
scenario: agent-chat-new-surface
date: 2026-07-05
operator: maintainer (M6 live dogfood)
outcome: pass
summary: A real tool call ran end-to-end (add 137+456 → 593) on the fixed build via OpenRouter.
---

# Evidence — tool call on the new surface (post-fix)

## What was exercised

A `defineAgent({ tools: [defineAgentTool(...)] })` calculator agent (`agents/calc.ts`, an `add` tool)
on a fresh scaffold, with the M6 tool-routing fix applied (via a `pnpm.overrides` pin to the fixed
`@theokit/agents` build). `POST /api/agents/calc` with
`{ "message": "What is 137 plus 456? Use the add tool." }`, `OPENROUTER_API_KEY` set.

## Result

The model invoked the tool and the tool executed end-to-end:

```
data: {"type":"tool-input-available","toolCallId":"call-b0abb253-…","toolName":"add","input":{"a":137,"b":456},"dynamic":true}
data: {"type":"tool-output-available","toolCallId":"call-b0abb253-…","output":"{\"stdout\":\"593\",…}"}
```

`137 + 456 = 593` — the LLM chose the tool, passed the right args, the handler ran, and the result
streamed back over the wire. This is the tool leg of the anchor, working live against a real model.

## Note (honest)

This run used the **fixed** `@theokit/agents` build (M6 commit `2302dcb`), pinned via `pnpm.overrides`,
because the published `@theokit/agents@0.30.0` still carries the pre-fix adapter (see the failure
evidence file). The fix ships to users with the `theokit@0.15.1` / `@theokit/agents@0.30.1` release.
