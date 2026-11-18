---
'theokit': minor
'create-theokit': patch
---

`theokit/server/webhook` now exports `verifyHmacSha256`, `decodeBase64Signature` and `decodeHexSignature` (and the `DecodeSignature` and `DecodeResult` types), so a webhook source the package does not ship can reuse the framework's constant-time, rotation-aware HMAC check. The `theokit-gateways` scaffold skill shows a custom verifier built on it.
