---
'theokit': minor
---

A tool handler that returns an object works, instead of throwing on the model's first call.

It threw: *"handler returned a non-string; provide toModelOutput to map it to a string."* The message was right and the moment was the worst available — the first time the **model** calls the tool, inside an agent run, with a provider key and tokens already spent, for a failure the compiler had the information to catch.

And returning an object is the natural shape: a tool answering `{ id, status, note }` serves a model better than one concatenating a string by hand. So this was the common path, not an edge — one report had 15 tools, all returning objects, all of which would have failed in execution.

A non-string result is JSON-serialized now. `toModelOutput` still wins whenever the shape the model should see differs from the shape the app wants; the default only decides what happens when nobody said.

Requiring it in the **type** was the other candidate. It keeps the ceremony: every consumer's correction was the same single line, `.toModelOutput((r) => JSON.stringify(r))`, and a default that every caller overrides identically is a default on the wrong side.

The explicit error survives for exactly the results no default can serialize — a circular structure, a `BigInt`, a function — and now names which one it hit, because asking for a `toModelOutput` there is advice that does not help.
