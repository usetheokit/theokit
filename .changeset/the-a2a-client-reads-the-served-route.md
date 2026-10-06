---
'@theokit/agents': major
---

**Breaking:** `createA2ATool` now reads the remote agent's reply as a UIMessage event stream. A remote that answers the `{ message }` POST with a JSON body carrying `response` or `text` is no longer supported; the call rejects, naming the tool, `0 chunks` and the response content type. (B-407)

Every agent route this framework serves, from `generateAgentRoutes` or `mountAgent`, answers with an event stream, and the tool used to call `res.json()` on that response, so it failed on the first byte of a real reply. The tool now returns the text of the streamed assistant message. A stream that carries an error frame, or that ends before its `finish` frame, rejects with an error naming the tool instead of returning partial text.

**Migration:** answer the `{ message }` POST with the event stream `generateAgentRoutes` or `mountAgent` produce, or stay on 15.x.
