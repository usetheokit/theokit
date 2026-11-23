---
'@theokit/agents': patch
---

`@theokit/agents/errors`: `TurnFailure.rawCode` keeps the code string before coercion and `describeTurnFailure` prints it for an unknown code; `describeTurnFailure` takes a `probe` hint that wins over the per-code hint and a `suffix`.
