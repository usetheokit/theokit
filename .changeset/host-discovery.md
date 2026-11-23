---
'@theokit/host': minor
---

Add `@theokit/host/discovery` with `announceService`, which announces a service on the local network through an injected DNS-SD publisher. It announces nothing on a loopback bind, trims the name to 63 UTF-8 bytes, and has a bounded `stop()`.
