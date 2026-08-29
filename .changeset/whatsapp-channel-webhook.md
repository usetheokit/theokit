---
'theokit': minor
'create-theokit': patch
---

WhatsApp can be served through `handleChannelWebhook`.

The channel seam could not serve the one platform `@theokit/gateway-whatsapp` exists for, for two
independent reasons. `theokit/server/webhook` exported `stripe`, `github`, `slack`, `telegram` and
`discord`, so a `validators` map with no `whatsapp` entry made the path answer 404 by construction.
And Meta verifies an endpoint before it delivers anything — a `GET` carrying `hub.mode=subscribe`,
`hub.verify_token` and `hub.challenge`, with the challenge echoed back as `text/plain` — which was
not modelled, so an app had to add a route of its own regardless.

Both halves close:

- `whatsapp({ appSecret })` verifies `X-Hub-Signature-256` — HMAC-SHA256 over the RAW body, which is
  the sharp edge a hand-rolled version gets wrong: hashing a parsed-and-restringified body compares
  different bytes and rejects correct requests.
- `whatsappSubscribe({ verifyToken })` answers the handshake, through a new per-platform `subscribe`
  map on `ChannelWebhookConfig`. Per-platform rather than a bare `verifyToken`, because the query
  shape is Meta's — shared with Instagram and Messenger, not universal. A `GET` on a platform that
  declared no responder answers 405, not 404: the platform is configured, it just does not do
  handshakes.

The signature scheme is the one GitHub already used — same header, same construction — so `github`
and `whatsapp` now share one implementation instead of two copies of a constant-time comparison,
a hex decoder and a rotation loop.

Nothing about the POST path changed, and its tests assert so.
