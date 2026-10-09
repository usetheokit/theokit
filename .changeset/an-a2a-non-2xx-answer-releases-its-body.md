---
'@theokit/agents': patch
---

`createA2ATool` cancels the response body before it rejects on a non-2xx answer. The body was left unread, so the connection stayed checked out until the `Response` was garbage-collected, and a remote answering 403 or 502 under load held sockets longer than needed. The rejection message is unchanged. (B-407)
