---
'@theokit/http': patch
'theokit': patch
---

A controller can read the raw request body again.

`resolveBody` consumed the request to populate `@Body`, unconditionally for POST, PUT and PATCH, and swallowed the failure when the payload was not JSON. The read still happened, so a handler taking `@Req()` received a request with `bodyUsed: true` and every later read threw `Body is unusable`.

That made `multipart/form-data` uploads and any signature-covered payload unreachable from a controller: the content-type and boundary arrived intact and the body was gone, while `@Body()` resolved to `undefined` because the JSON parse that drained it had failed.

It now reads a `clone()`. The JSON path is unchanged.
