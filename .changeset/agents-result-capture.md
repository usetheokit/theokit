---
'@theokit/agents': minor
---

Add `createResultCapture`, `ResultCapture` and `NoResultSubmittedError`: a `submit_result` tool whose input schema comes from a zod object schema, so a tool-using run's final answer is read as a validated object with `result()`.
