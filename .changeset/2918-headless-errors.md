---
'@theokit/agents': patch
---

`runHeadlessTurn` returns `errorMessage` (a thrown stream or the first `error` event) and takes `onFormatError: 'fail'`, which makes a throwing `format` an `error` outcome.
