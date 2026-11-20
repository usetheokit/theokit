---
'@theokit/agents': minor
---

`@theokit/agents/control` gains `createDevicePairing` and `pairRoute`: a short-lived one-use setup code, a device-chosen credential stored only as a SHA-256 digest (file mode 0600), owner approve, deny and revoke, constant-time `accepts` for a Bearer header, and `onRevoke` so the caller can close the revoked device's sockets.
