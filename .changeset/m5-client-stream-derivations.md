---
"theokit": minor
---

Agent chat surfaces now have ready-made views over the event stream — no manual reducing in your components.

- `useAgentStream` returns two new derived fields: `liveText` (the assistant's reply so far, concatenated from every message chunk) and `error` (the last error event, with its `code`/`retriable` flags intact for branching).
- New `useAgentToolCards` hook (and the pure `foldAgentToolCards` reducer behind it) turns the raw event stream into correlated tool cards — each with `running` / `success` / `error` status — so a tool-call UI is a `.map()` instead of a state machine. Cards correlate by event `id`, with a FIFO-by-name fallback when the transport omits ids; the success/error verdict comes from an injectable `resolveEnvelope` so you can match your own tool result shape.
- All of the above are also exported as pure functions (`deriveLiveText`, `deriveError`, `foldAgentToolCards`, `defaultResolveEnvelope`) for use outside React.
