---
'@theokit/agents': minor
---

`installDiagnosticSink` takes an `envVar` option, so an app can read its own variable name instead of `THEOKIT_DIAGNOSTICS`. An empty `envVar` throws a `ConfigurationError`.
