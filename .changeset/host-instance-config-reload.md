---
'@theokit/host': minor
---

`defineInstanceConfig` gains `reload` and `watch`: a changed `hot` key is applied to the environment (a variable the caller set is left alone), other changed keys are reported as `restartRequired`, a file that fails a key's `parse` or the optional `validate` is refused and keeps the running values, and a failing watcher is closed and reported as a `watch-failed` event. No event carries a value.
