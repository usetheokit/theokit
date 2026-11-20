# Webhooks

`theokit/server/webhook` ships verifiers for GitHub, Meta, LINE and other platforms. For a
platform the package does not ship, build a verifier from the same HMAC-SHA256 primitive the
built-in ones use: it signs the raw body, compares in constant time, tries every configured
secret, and refuses every delivery when no secret is set.

## Custom HMAC verifier

```ts
import { decodeBase64Signature, verifyHmacSha256 } from 'theokit/server/webhook'

// During a rotation pass both keys; otherwise just the current one.
const secrets = [process.env.MY_KEY_OLD, process.env.MY_KEY].filter(
  (key): key is string => typeof key === 'string' && key.length > 0,
)

export const myPlatform = verifyHmacSha256({
  header: 'x-webhook-signature',
  secrets,
  option: 'signatureKey', // named in the refusal reason when `secrets` is empty
  decode: decodeBase64Signature,
})
```

- `decodeBase64Signature` reads a standard base64 header (LINE's rule).
- `decodeHexSignature('sha256=')` reads hex with a required prefix (GitHub and Meta's rule);
  call `decodeHexSignature()` for bare hex.
- A custom `decode` is any `(value: string) => DecodeResult`, returning
  `{ ok: true, bytes }` or `{ ok: false, reason }`.
- A mismatch yields `{ ok: false, reason: 'signature mismatch' }`.
