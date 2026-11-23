---
'@theokit/agents': patch
---

`@theokit/agents/control`: `redeemPairing({ url, code, name })` redeems a setup code at the pairing route and returns the socket URL and the credential; a refused or expired code throws `PairingRefusedError`.
