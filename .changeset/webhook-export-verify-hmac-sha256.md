---
'theokit': minor
---

`theokit/server/webhook` now exports `verifyHmacSha256`, `decodeBase64Signature` and `decodeHexSignature` (and the `DecodeSignature` and `DecodeResult` types), so a webhook source the package does not ship can reuse the framework's constant-time, rotation-aware HMAC check.
