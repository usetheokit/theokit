---
'@theokit/http': minor
---

`createNodeServer` accepts `trustedProxy: { identityHeader, addresses }`: the identity header and `x-forwarded-proto` are believed only from an allowlisted TCP peer. New exports `trustedIdentity(request)`, `peerAddress(request)`, `PEER_ADDRESS_HEADER`, `TRUSTED_IDENTITY_HEADER` and `TrustedProxyOptions`. The server always strips client-supplied internal headers and, without `trustedProxy`, ignores `x-forwarded-proto`.
