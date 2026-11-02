---
"@theokit/agents": patch
---

A guarded turn's `stream()` now rejects with a guard defect, such as the `MalformedGuardrailResultError` a guard returning `redact` with no `text` raises, instead of ending the stream with an `ERROR` status as if the guard had refused. A guard that blocks (`GuardrailViolationError`) still ends the stream with the `ERROR` status message, and `wait()` behaves as before: it rejects with the same error in both cases. A `checkOutput` that throws its own `GuardrailError` subclass now makes `stream()` reject too; return `{ action: 'block' }` to refuse. (B-457)
