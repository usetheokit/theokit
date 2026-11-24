---
'@theokit/agents': patch
---

`runHeadlessTurn` returns `errorMessage` (the first `error` event, thrown stream or fatal formatter), and `onFormatError: 'fail'` makes a throwing `format` an `error` outcome.
