---
'@theokit/agents': minor
---

Added, from `@theokit/agents`, `classifyTurnFailure` and `describeTurnFailure`: any thrown turn error, with its cause chain, becomes a code, a transient flag taken from typed fields only, and a one-line description with a next-step hint. `DEFAULT_TURN_FAILURE_HINTS` holds neutral wording the caller can override per code.
