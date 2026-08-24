---
'theokit': patch
---

A `POST` carrying a JSON body reaches its `/api` route under `theokit start`. Every such request hung
forever — no status, no error, no timeout, the connection simply stayed open and the handler was
never called — while `theokit dev` answered the identical request in single-digit milliseconds.

The agent auxiliary branch ran for every URL and built a Web `Request` from the Node one *before*
asking whether it owned the path. That conversion wraps the Node readable with `Readable.toWeb()`,
which drains it, and a Node stream drains once. The API branch then reached `parseJsonBody`, attached
an `'end'` listener to a readable that had already ended, and waited for an event that cannot fire
twice. `theokit dev` was unaffected because its middleware matches the aux paths before it converts.

`serveAgentAuxRoute` now takes a deferred `WebRequestSource` instead of a `Request`: it answers every
fall-through from the URL, the method and the agent table alone, and calls `toRequest()` only on a
path it is about to answer. The same ordering fault reached agent routes (`POST /api/agents/<name>`)
and controller routes as a silently empty body rather than a hang; both are fixed by the same change.
Actions (`/api/__actions/…`) were never affected — they matched their prefix before the aux branch
ran.

Second layer, so the next occurrence is legible rather than silent: `parseRequestBody` refuses a
stream that has already ended, with a named `RequestBodyConsumedError` and a 500 — the framework
drank the body, so it is not the caller's 400 to fix. A declared-empty body (`content-length: 0`)
stays the absent body it is.
