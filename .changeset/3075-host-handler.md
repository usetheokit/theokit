---
'@theokit/host': minor
---

`createChannelAssistant` no longer imports `@theokit/gateway-agent`, whose SDK peer range (`<10`) cannot resolve with the host's (`>=12 <14`) under npm. The `gateway-agent` peer is removed, and the `reply` option is replaced by `replyHandler`: `({ agentFor, secrets }) => createAgentHandler({ agentFor, secrets, ...reply })`. Owned sessions now need `handler` or `replyHandler`.
