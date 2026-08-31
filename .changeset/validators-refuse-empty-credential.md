---
'theokit': patch
---

Webhook validators refuse an unusable credential instead of throwing, misreporting, or — in one
case — accepting.

`line({ channelSecret: '' })` raised `DataError: Zero-length key is not supported` from inside
WebCrypto's `importKey`, which is what one unset environment variable produces at the natural call
site `process.env.LINE_CHANNEL_SECRET ?? ''`. The throw escapes `handleChannelWebhook` as a 500,
past the 401 branch written to say why a delivery was refused, and the operator gets a crypto error
naming neither the variable nor the platform.

Applying the same lens to every validator in the directory found two further shapes. An empty
rotation list (`{ channelSecret: [] }`) answered `signature mismatch` after comparing against
nothing, which sends the reader to look at the sender's signature rather than at their own
configuration. And `whatsappSubscribe({ verifyToken: '' })` **accepted** a caller presenting an
empty `hub.verify_token`, completing the subscribe handshake for anybody who asked — the verify
token is the only credential on that request, so that one was an authentication bypass rather than
a diagnostic problem.

All eight validators now refuse a configuration that cannot verify anything, through one shared
decision, with a reason that names the option the operator has to set. A half-configured rotation
(`['current', '']`) refuses rather than quietly verifying with the secret that is set — otherwise
the mistake surfaces on the day the remaining secret is retired, in production, against all
traffic.
