---
name: theokit-gateways
description: Receiving messages from Telegram, WhatsApp, Slack and other platforms — handleChannelWebhook, the @theokit/gateway-* adapters, signature validation, the onMessage seam
user-invocable: false
paths:
  - 'server/routes/**'
  - 'server/channels/**'
  - '**/*gateway*'
  - '**/*webhook*'
---

# TheoKit Gateways

Receiving a message from a messaging platform spans three packages, and each owns one part of it.

| Package              | Its half                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theokit` (here)     | The HTTP route and the signature check. `handleChannelWebhook` verifies the signature, parses the body, and hands your app the parsed JSON as `payload: unknown` |
| `@theokit/gateway-*` | Translating that payload into a canonical event, so your app never re-declares a platform's wire format                                                          |
| `@theokit/sdk`       | Not involved in this path today                                                                                                                                  |

## Wiring one

`handleChannelWebhook` is not mounted for you. It takes a `Request`, the URL path, and a config, and
returns the `Response` your route must return.

```typescript
import { handleChannelWebhook } from 'theokit/server/agent'
import { telegram } from 'theokit/server/webhook' // also: discord, slack, github, stripe, whatsapp
import { parseInbound } from '@theokit/gateway-telegram'

const response = await handleChannelWebhook(request, new URL(request.url).pathname, {
  validators: { telegram: telegram({ secretToken: process.env.TELEGRAM_SECRET_TOKEN! }) },
  onMessage: async ({ agent, platform, payload }) => {
    const event = parseInbound(payload)
    if (event === null) return // not a message this adapter handles — see below
    // hand `event` to your agent
  },
})
```

The path it expects is `POST /api/agents/<name>/channels/<platform>/webhook`; `<name>` and
`<platform>` arrive in `onMessage` as `agent` and `platform`.

## Platforms that verify the endpoint first (WhatsApp, Instagram, Messenger)

Meta will not deliver anything until it has verified the URL with a `GET` carrying
`hub.mode=subscribe`, `hub.verify_token` and `hub.challenge`, and it requires the challenge echoed
back as `text/plain`. Declare a responder per platform and mount the route for `GET` as well as
`POST`:

```typescript
import { whatsapp, whatsappSubscribe } from 'theokit/server/webhook'

const response = await handleChannelWebhook(request, new URL(request.url).pathname, {
  validators: { whatsapp: whatsapp({ appSecret: process.env.META_APP_SECRET! }) },
  subscribe: { whatsapp: whatsappSubscribe({ verifyToken: process.env.META_VERIFY_TOKEN! }) },
  onMessage: async ({ payload }) => {
    /* … */
  },
})
```

`appSecret` is the Meta **app secret**, not the access token — the signature is HMAC-SHA256 of it
over the raw body. `verifyToken` is the string you typed into the Meta app when registering the URL;
comparing it is the only thing standing between an arbitrary caller and a subscription. A `GET` for
a platform with no `subscribe` entry answers `405`, not `404`: the platform is configured, it just
does not do handshakes.

Developing against any of this needs a public URL. `theo.config.ts` has `allowedHosts` for exactly
that — see the framework README.

**Give it a `Request` whose body has not been read.** It calls `request.json()` itself, so a wrapper
that has already parsed the body — `defineRoute` offers a parsed `body` in its handler context —
leaves nothing for it to read. Mount it where you still hold the original request, or pass a clone.

`ChannelMessage` is `{ agent, platform, payload }`. There is no `request` inside `onMessage`, because
the body was read and the signature checked before it ran.

## Never throw out of `onMessage`

`onMessage` is awaited **before** the 200 is built, and `handleChannelWebhook` does not catch around
it. A throw there means the 200 is never built: mounted in a TheoKit route, the rejection reaches
that route's error boundary and is answered 500 — the platform sees a failed delivery where it
expected an acknowledgement.

This is why every adapter's translator returns `null` (or `undefined`) for a payload it does not
recognise rather than throwing. Handle the `null` and answer normally.

## Which adapters go through this seam

Only platforms that deliver by **webhook**. Telegram and the SMS providers export `parseInbound`
under that name; LINE, WhatsApp Cloud and Teams export their translation under their own names, each
with its own signature — read the one you are using.

Adapters whose transport is a long-lived connection — Discord, Slack, Mattermost, Matrix, e-mail,
and WhatsApp's `web` and `baileys` backends — do **not** go through this seam. They own their
transport, and running one alongside a TheoKit server needs a process lifecycle this scaffold does
not set up.
