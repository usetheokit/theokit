---
'@theokit/host': patch
---

Add `createChannelAssistant` (`@theokit/host/channel-assistant`): channels, a session pool, the gateway hooks in a fixed order (pre-hooks, access policy, app hooks, help), the reply handler, secret masking, the webhook router and an ordered teardown, in one call. `@theokit/gateway` and `@theokit/gateway-agent` are optional peers.
