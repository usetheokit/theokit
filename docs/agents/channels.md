# Channels — messaging webhooks (M27)

**Status:** M27 (ADR-0041). Auto-generate a signed inbound webhook route per messaging platform,
wiring the SDK gateway packages into your app's HTTP surface. TheoKit provides the **route + the
signature gate**; the SDK gateway (`@theokit/gateway-*`) does the payload→agent translation.

## The route

`handleChannelWebhook` serves `POST /api/agents/<name>/channels/<platform>/webhook`. It validates the
platform signature **before** any handoff — an invalid signature returns `401` and never reaches
`onMessage`; an unconfigured platform returns `404`.

```ts
import { handleChannelWebhook } from 'theokit/server'
import { slack, telegram, discord } from 'theokit/server/webhook'

const res = await handleChannelWebhook(request, urlPath, {
  validators: {
    slack: slack({ signingSecret: process.env.SLACK_SIGNING_SECRET! }),
    telegram: telegram({ secretToken: process.env.TELEGRAM_SECRET! }),
    discord: discord({ publicKey: process.env.DISCORD_PUBLIC_KEY! }),
  },
  // Handoff seam — wire the SDK gateway / your agent here (only runs after validation passes).
  onMessage: async ({ agent, platform, payload }) => {
    await routeToAgent(agent, translate(platform, payload))
  },
})
```

## Per-platform signature validation

Each validator is a webhook `VerifyFn` that extends the existing webhook framework (reuse, not
reimplement):

| Platform | Scheme | Header(s) |
|---|---|---|
| **Slack** | HMAC-SHA256 (shipped `slack()` provider) | `X-Slack-Signature` + `X-Slack-Request-Timestamp` |
| **Telegram** | secret-token constant-time compare | `X-Telegram-Bot-Api-Secret-Token` |
| **Discord** | **Ed25519** over `timestamp + rawBody` (Web Crypto, no third-party crypto) | `X-Signature-Ed25519` + `X-Signature-Timestamp` |

A negative-case test asserts a tampered body / wrong token is rejected (`401`). `theokit@0.17.0`.

## What TheoKit does NOT do

TheoKit does not reimplement the gateway's message parsing (G2). The validated payload is handed to
`onMessage`, where an app wires the SDK gateway package (`@theokit/gateway-telegram`, etc.) that
translates the platform payload into an agent turn.

---

## Related

- [A2A](./a2a.md) — cross-network agent-to-agent delegation
- [MCP](./mcp.md) — expose an agent as an MCP server
- [Feature backlog](./feature-backlog.md) — parity tracker (M27)
