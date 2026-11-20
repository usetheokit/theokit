---
'@theokit/agents': minor
---

Add `createResultCapture`: a `submit_result` tool whose input schema is your zod schema, so a tool-using run can end with a schema-validated object. An invalid submission goes back to the model as a tool error; `result()` returns the last valid one or throws `NoResultSubmittedError`, and a non-object schema throws `ConfigurationError`.
