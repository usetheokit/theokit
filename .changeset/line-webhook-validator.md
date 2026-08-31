---
'theokit': minor
---

`line({ channelSecret })` — LINE webhooks are servable through `handleChannelWebhook`.

`server/webhook` shipped validators for six platforms and LINE was not one of them, while
`@theokit/gateway-line` already published the primitive. Neither package was wrong on its own —
nothing joined them, so every app that wanted LINE wrote the bridge itself. Measured in a real
consumer: 19 non-comment lines, reimplementing two details that are easy to get wrong and expensive
to debug.

**The body is signed as bytes.** A parsed-and-restringified body hashes differently and rejects
every correct delivery. `handleChannelWebhook` hands a validator a `clone()` precisely so the raw
bytes survive, but an app writing its own has to know that unprompted (same defect as #534, #556).

**It is base64, not hex.** A reader who copies the GitHub or WhatsApp validator — same algorithm,
same body, same secret — produces a hex digest and gets a 401 indistinguishable from a wrong channel
secret.

`channelSecret` accepts an array, so a rotation is an overlap rather than an outage.

This adds a named helper, not a gate: `validators` is `Record<string, VerifyFn>` and always accepted
a hand-written one — unlike the closed provider registry of #579/#585, which refused what it did not
name. Teams, SMS, Matrix and Mattermost are in the same position and are not addressed here; LINE is
the one measured against a working consumer.

Internally, the HMAC-SHA256-over-raw-body core now has one implementation shared by all three
schemes (`hub-signature-256` moved onto it), so the constant-time compare and the no-early-return
secret loop live in one place rather than three.
