---
'theokit': minor
---

A controller can declare that it authenticates by other means, with `@SetMetadata('theokit:csrf-exempt', true)`.

The case this exists for is a webhook. Stripe, GitHub and every other sender authenticate with an HMAC over the request body and will never send `X-Theo-Action`, so a webhook endpoint answered 403 to every real delivery and the only escape was `csrf: 'warn'` for the whole application.

It is deliberately separate from `theokit:public`, which answers a different question — whether an unauthenticated caller may reach the route, not whether the route authenticates some other way. A route can want one without the other.

Declared on the controller, and absence still means the gate applies.
