# Hermes gateway — connected to a real Telegram bot, end to end

**Source:** `github.com/NousResearch/hermes-agent`, MIT, Copyright (c) 2025 Nous Research.
**Verified 2026-09-17** against a live Telegram bot on Paulo's own account.

This closes the one gap Tier 1 could not: **no message had ever been sent or received.** Now one
has, and the whole path is evidenced rather than described.

## What was connected

A bot already existed on Paulo's account — `@theo_paulo_bot`, "Theo — my assistant" — so **no new
bot was created**. Its token was validated against the API before anything was configured:

```
GET /getMe → ok: @theo_paulo_bot (id 8982152421, "Theo — my assistant")
```

Configuration is two `.env` lines (`chmod 600`): the bot token, and
`TELEGRAM_ALLOWED_USERS=<user id>`. **The user id was not guessable** — it was captured by sending
`/start` to the bot and reading `getUpdates`, which is the only way a bot learns who is talking to
it.

## The connection, and one real-world detail in it

```
[Telegram] Discovering Telegram API fallback IPs via DNS-over-HTTPS…
[Telegram] Connecting to Telegram (attempt 1/8)…
[Telegram] Connected to Telegram (polling mode)
```

**It resolves Telegram's API over DoH before connecting, and retries up to 8 times.** That is a
product that expects to run on networks where Telegram's DNS is blocked or poisoned — a condition
nobody designs for until a user hits it.

## The round trip, evidenced at all three layers

A message sent from Paulo's own Telegram client: *"Responda exatamente: GATEWAY-E2E-OK"*.

**1 — the agent received and answered** (session store, `~/.hermes/state.db`):

```
[user]      Responda exatamente: GATEWAY-E2E-OK
[assistant] GATEWAY-E2E-OK
```

**2 — the reply reached Telegram** (read back from the web client's own DOM, not from a log):

```
"Responda exatamente: GATEWAY-E2E-OK"   ← sent
"GATEWAY-E2E-OK"                        ← the bot's reply, newest in the conversation
```

**3 — the delivery ledger recorded the obligation as discharged** — the mechanism read about in
`delivery_ledger.py` earlier today, now observed holding a real row:

| column | value |
|---|---|
| `obligation_id` | `3b23ebe5a41bc6ffebf520aa` |
| `session_key` | `agent:main:telegram:dm:7528967933` |
| `platform` / `chat_id` | `telegram` / the user's id |
| `content` | `GATEWAY-E2E-OK` |
| **`state`** | **`delivered`** |
| `attempts` | 0 |
| `owner_pid` / `owner_started_at` | the gateway's pid, plus its process start time |
| `last_error` | NULL |

**`owner_pid` + `owner_started_at` together are the liveness check** the docblock described: a pid
alone can be recycled, so the start time disambiguates. And `state: delivered` is reached **only on
`SendResult.success`** — the agent answering and the message arriving are two facts, and this table
is what keeps them separate.

## The session key is the addressing model

`agent:main:telegram:dm:7528967933` — agent, profile lane, platform, conversation kind, peer id.
**One string that routes a reply back to exactly one conversation on one platform.** That is what
`GatewayContext.reply` auto-routing needs, and what PIECE-4 will have to construct.

## Two method errors of mine, recorded because both cost a probe

1. I queried the session store for `session_id like '%telegram%'` and got zero. **Telegram sessions
   are not named after the platform** — the id is a plain timestamp, and the platform lives in the
   session *key*, not the id. The zero was about the query.
2. I read the gateway log looking for a delivery line and found nothing after "Connected". **Normal
   operation is quiet.** Absence in a log is not absence of behaviour; the state store had it.

## What this establishes for TheoClaw

- **The full loop works in the product we are matching**, and the three-layer evidence above is the
  standard PIECE-4 should be held to: agent answered, platform received, obligation discharged.
- **`delivery_ledger` stops being a docblock.** It is a real table with a real discharged row, and
  our design has nothing in that position — a crash between answer and ACK loses the reply silently.
- **Default-deny authorization is not theoretical.** The gateway refused to start any platform until
  an allowlist existed, and PIECE-9 now has a working reference for what "who may talk to this
  agent" looks like in practice.

## State left behind

**The gateway is RUNNING** (`hermes gateway run`, pid recorded in `/tmp/hermes-gw.log`) and the bot
is live: any message Paulo sends to `@theo_paulo_bot` is answered by Hermes and **billed to his
OpenRouter key**. It runs from an ephemeral `/tmp` scratchpad, so it dies with the scratchpad.

Stop it with `kill <pid>`, or leave it; it is named here rather than left as a surprise.
