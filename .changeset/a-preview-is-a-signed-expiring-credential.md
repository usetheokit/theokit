---
"theokit": minor
---

Add the preview marker — a signed, expiring credential that marks a request as a preview,
and the response headers that keep a preview out of indexes and caches.

The expiry travels **inside the signed payload**, not beside it. A cookie's own `Max-Age`
is advisory: a client that keeps sending an expired cookie is not misbehaving, it is
merely a client, so the server has to be the one that refuses. `isPreview` reads the `exp`
the signature covers and compares it against now.

A preview response carries `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private,
no-store`. The prerender exemption that applies to the nonce deliberately does **not**
apply here: a prerendered preview is still a preview, and a shared cache holding one is
the failure this closes.
