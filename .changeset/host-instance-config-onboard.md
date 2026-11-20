---
'@theokit/host': minor
---

`defineInstanceConfig` gains `onboard`: a first-run command that collects each declared key from answers, named environment variables or prompts (a `secret` key is read with echo off and raw mode is always restored), checks the values with each key's `parse` and an optional `validate`, and writes the file. Without `force` the existing file is refused atomically by `write`. Nothing printed or thrown holds a value.
