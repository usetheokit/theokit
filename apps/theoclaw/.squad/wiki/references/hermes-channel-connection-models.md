# How each channel actually connects — all 22, classified by transport

**Source:** `github.com/NousResearch/hermes-agent`, MIT, Copyright (c) 2025 Nous Research.
**Read 2026-09-17** from `plugins/platforms/*/plugin.yaml` and the adapters. **Only Telegram was
run** — see `hermes-gateway-e2e-verified.md`. Everything else here is the declared mechanism, and
that is stated rather than implied.

## The axis that matters is NOT the platform — it is whether it needs a public URL

A self-hosted assistant on somebody's laptop can hold an outbound socket forever. It cannot receive
an inbound HTTPS request without a tunnel, a static IP or a hosted relay. **That single property
splits the 22 into groups with completely different deployment costs**, and it is the first thing a
TheoClaw channel design has to decide per platform.

### Group A — outbound only. Works behind NAT, no URL, no tunnel. (13)

| Platform | Mechanism |
|---|---|
| **telegram** | Bot API **long-poll** — ✅ the one verified end to end |
| **slack** | `slack-bolt` in **Socket Mode** |
| **discord** | `discord.py` gateway websocket |
| **matrix** | `mautrix`, **optional E2EE** |
| **mattermost** | v4 REST + WebSocket event stream |
| **dingtalk** | `dingtalk-stream` SDK, Stream Mode |
| **feishu / lark** | `lark-oapi` over WebSocket (webhook also possible) |
| **wecom** | Smart Robot over WebSocket |
| **homeassistant** | subscribes HA's WebSocket event bus, per-entity cooldowns |
| **simplex** | local `simplex-chat` daemon over WebSocket |
| **irc** | raw IRC over stdlib asyncio — **zero external dependencies** |
| **buzz** | Nostr relay (Block's human+agent platform) |
| **photon** | `spectrum-ts` SDK long-poll → **iMessage** |

**This is the group a laptop-hosted assistant can use today with nothing but a credential.**

### Group B — inbound webhook. Needs a publicly reachable HTTPS endpoint. (5)

| Platform | Mechanism | The catch |
|---|---|---|
| **line** | own `aiohttp` webhook server, **HMAC-SHA256** signature verification | replies prefer the **free reply token**, fall back to the metered Push API |
| **sms** | Twilio REST out + inbound webhook | markdown is **stripped to plain text** |
| **teams** | Bot Framework | **owns its own HTTP server** and validates its own JWT — it does not fit a shared seam |
| **google_chat** | authenticated HTTP callbacks **or** Cloud Pub/Sub pull | Pub/Sub pull turns it into Group A |
| **wecom_callback** | self-built apps over an HTTP callback endpoint | registered as a *second* platform beside `wecom` |

**Two of these have an escape hatch and it is worth noting:** Google Chat can be pulled via Pub/Sub
instead of pushed, and Feishu offers WebSocket *or* webhook. **The same platform can be in either
group depending on how you connect it** — which is a design choice, not a platform property.

### Group C — everything else (4)

| Platform | Mechanism |
|---|---|
| **whatsapp** | a **local Node.js bridge** — see below |
| **email** | polls an **IMAP** mailbox, replies over **SMTP** |
| **ntfy** | subscribes a topic over **HTTP streaming**, publishes replies by POST |
| **raft** | loopback HTTP endpoint receiving **content-free wake hints** |
| **a2a** | not a chat platform — Linux Foundation **Agent-to-Agent v1.0**, both directions |

## WhatsApp in detail, because it is the one that is different

WhatsApp has **no bot API for personal accounts**. Hermes' answer:

```
Python adapter  ──spawn──▶  Node.js process
                             @whiskeysockets/baileys 7.0.0-rc13   (WhatsApp Web protocol)
                             express ^4.21                        (local HTTP API)
                             qrcode-terminal                      (pairing)
      │                          │
      └──── polls / POSTs ───────┘   over localhost HTTP
```

`hermes whatsapp` → *"Configure WhatsApp and pair via QR code."* **A human scans a QR with their
phone**, once, and the session persists. There is no token to put in a `.env`.

**Three consequences, and none of them is optional:**

1. **A Node runtime is a hard dependency** for this platform and only this platform.
2. **It is an unofficial client.** Baileys reimplements WhatsApp Web; Meta does not sanction it, and
   the account is a real personal account, not a bot.
3. **Pairing cannot be automated.** Any "install and it works" story has a human step here.

**And the process hygiene around it is worth copying.** The adapter carries
`_pid_looks_like_node_bridge(pid)` and `_bridge_pid_is_ours(pid, session_path, expected_start)`, and
its comment is explicit: *"Any ambiguity (process gone, unreadable cmdline) refuses the kill."* It
will not SIGTERM a pid it cannot prove is its own bridge — **the same pid-plus-start-time identity
check the delivery ledger uses**, applied to process management. A recycled pid does not get killed
by mistake.

WhatsApp Business (Cloud API) is a **separate** command (`hermes whatsapp-cloud`) and a separate
platform key — official, token-based, webhook-driven, Group B. **They are two different products
that share a name**, and a parity table with one "WhatsApp" row is wrong.

## WhatsApp: VERIFIED end to end, 2026-09-18

Paired and exercised on a real personal account. The three-layer evidence, same standard as
Telegram:

```
[user]      ola tudo bem?
[assistant] Olá! Tudo bem, obrigado! E você? Como posso ajudar?
delivery_obligations: whatsapp → 231116569108705@lid | state=delivered | attempts=0 | err=None
```

### The identity model is NOT a phone number, and that is new

Telegram's `chat_id` was the user's numeric id. WhatsApp's is **`231116569108705@lid`** — a LID,
the opaque identifier WhatsApp adopted so a chat does not expose a phone number.

**Two platforms, two identity shapes, in the first two we connected.** An allowlist, a session key
and any per-user memory scope must accept both, and neither generalises from the other. The paired
account's own JID is a phone number (`553598838687`) while the conversation id is a LID — so even
within WhatsApp, *the number you pair with is not the id you route to*.

`gateway/whatsapp-bridge/` carries `buildLidMap()` and a `lidToPhone` map rebuilt on every
`creds.update`, which is the product paying for exactly this.

### What pairing actually cost — four failures, three of them mine

1. **The wizard writes to `~/.hermes/.env`, not the repo's `.env`.** Telegram worked from the repo
   file because the process inherits its environment; WhatsApp did not, because its adapter reads
   through `get_scoped_secret` — *"WHATSAPP_\* env via the profile secret scope (multiplexed
   profiles see their own .env, not the process-global value)"*. **The same product reads two
   different files depending on the adapter**, and only one is canonical (`hermes config env-path`).
2. **A piped answer landed in the wrong field.** Driving the wizard non-interactively put `2` — the
   menu choice for self-chat — into `WHATSAPP_ALLOWED_USERS`. The config looked complete and
   allowlisted nobody.
3. **A `--pair-only` bridge left running for 5h40 held the session**, so the gateway could not start
   its own serving bridge. Killing it let the gateway spawn `bridge.js --port 3000`, which answers
   `/health` with `{"status":"connected","queueLength":0}`.
4. **Not a failure: the ASCII QR scans fine.** It was accused here of being unscannable in
   `qrcode-terminal` small mode. It is not — the pairing succeeded on the first real attempt in a
   tmux pane with a TTY. The hypothesis was wrong and the QR was never the problem.

**The lesson that transfers to TheoClaw is #1.** A product with per-adapter config scopes will have
one adapter that works and one that silently does not, and the difference is invisible in the logs —
the gateway never once said "whatsapp" while it was misconfigured. `hermes doctor` did not catch it
either; it reported *"✓ WhatsApp bridge deps"* the whole time.

## What this means for TheoClaw

1. **Six of our ten catalog platforms are Group A** — telegram, discord, slack, matrix, mattermost,
   email(ish). That matches the six that already close the loop in `theokit-gateways`, and it is not
   a coincidence: Group A is what works without infrastructure.
2. **Our four "webhook-only" are Group B**, and PIECE-5 is really "how does a self-hosted app get a
   public HTTPS URL". Hermes does not solve that — it ships the webhook server and leaves the tunnel
   to the operator.
3. **Teams is genuinely separate in both products.** Hermes: Bot Framework owns its own server.
   Ours: no signature verifier because `@microsoft/teams.apps` validates the JWT itself. **Two
   independent codebases reached the same conclusion**, which is the strongest signal available that
   Teams will not fit a shared seam.
4. **WhatsApp needs a product decision before a technical one:** unofficial bridge with QR pairing
   and a Node dependency, or official Cloud API with a token and a webhook. Hermes ships **both**.

## What this note does NOT establish

- **Only Telegram was executed.** The other 21 are read from `plugin.yaml` descriptions and adapter
  docblocks — no credential was supplied for any of them, nothing was paired, no webhook received.
- **No adapter implementation was read in full** except WhatsApp's process-management helpers.
- **Rate limits, media handling and per-platform formatting are unexamined**, beyond the notes
  already in `hermes-tier1-verified.md` about the display resolver.
