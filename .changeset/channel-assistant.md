---
'@theokit/host': patch
---

Add `createChannelAssistant` (`@theokit/host/channel-assistant`): channels, a session pool (or the app's own), the gateway hooks in a fixed order (pre-hooks, access policy, app hooks, help), the reply handler (or the app's own), secret masking of replies, lines and output streams, the webhook router, a transcript sweeper, extra services and an ordered teardown, in one call. An assistant with no access policy is refused. `@theokit/gateway` and `@theokit/gateway-agent` are optional peers.
