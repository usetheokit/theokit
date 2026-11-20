---
'@theokit/host': minor
---

Add `@theokit/host/instance-config`: `defineInstanceConfig` declares an agent app's per-user env config file and locates, loads, writes (mode 0600, atomic, validated) and audits it. Adds `InstanceConfigError`.
