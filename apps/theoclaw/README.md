# TheoClaw

A personal AI assistant that lives where its user already writes: one agent answering on Telegram,
Discord, Slack, Matrix, Mattermost, e-mail, LINE, WhatsApp, Microsoft Teams and SMS.

The channel loop that reads the configuration below is still being built (`src/` has the
composition root only). The variables are the contract it is being written against.

## Configuration

TheoClaw reads its configuration from environment variables, all prefixed `THEOCLAW_`. The full
list, with a comment per variable, is in [`.env.example`](./.env.example).

```bash
cp apps/theoclaw/.env.example apps/theoclaw/.env   # git ignores .env
chmod 600 apps/theoclaw/.env
```

Load it into the process with `node --env-file=apps/theoclaw/.env ...`, or into the shell with
`set -a; . apps/theoclaw/.env; set +a`. Variables already set in the environment work the same way,
so a file kept outside the repository and sourced from your shell profile is also fine.

### Required

| Variable | Meaning |
|---|---|
| `THEOCLAW_MODEL` | Model id the agent runs, e.g. `openrouter/google/gemini-2.5-flash-lite`. The first segment picks the provider and therefore the key it reads (`OPENROUTER_API_KEY` for `openrouter/...`). There is no default: startup fails and names the variable. |
| `THEOCLAW_PORT` | Port for the webhook routes. Digits only, 0 to 65535. |

### Platforms

Every platform is optional. A platform runs when all of its variables are set and non-blank;
otherwise startup skips it and prints `<platform>: not configured (missing ...)` with the names.

| Platform | Variables | Transport |
|---|---|---|
| Telegram | `TELEGRAM_TOKEN` | long polling |
| Discord | `DISCORD_TOKEN` | gateway; the bot needs the Message Content intent |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` | Socket Mode; the app token needs `connections:write` |
| Matrix | `MATRIX_HOMESERVER_URL`, `MATRIX_ACCESS_TOKEN`, `MATRIX_USER_ID` | client-server API |
| Mattermost | `MATTERMOST_BASE_URL`, `MATTERMOST_ACCESS_TOKEN` | REST and WebSocket, bot account |
| E-mail | `EMAIL_ADDRESS`, `EMAIL_PASSWORD`, `EMAIL_IMAP_HOST`, `EMAIL_SMTP_HOST` | IMAP in, SMTP out |
| LINE | `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` | webhook `/webhooks/line`; replies use the push API |
| WhatsApp Cloud | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | webhook `/webhooks/whatsapp` |
| Microsoft Teams | `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET`, `TEAMS_TENANT_ID` | Bot Framework webhook; needs a work tenant |
| SMS (Twilio) | `SMS_TWILIO_ACCOUNT_SID`, `SMS_TWILIO_AUTH_TOKEN`, `SMS_TWILIO_FROM_NUMBER`, `SMS_PUBLIC_URL` | webhook `/webhooks/sms` |

Names in the table omit the `THEOCLAW_` prefix.

### Webhooks need a public URL

LINE, WhatsApp, Teams and SMS deliver messages by calling an HTTPS URL, so `THEOCLAW_PORT` has to
be reachable from the internet. During development a tunnel does this, for example a Cloudflare
named tunnel pointing a stable hostname at `http://localhost:$THEOCLAW_PORT`. Register
`https://<host>/webhooks/<platform>` in each platform's console. For SMS, `THEOCLAW_SMS_PUBLIC_URL`
must be that exact URL, because Twilio signs the URL it called.

### Platform limits seen with test accounts

- A Twilio trial account sends only Twilio's predefined templates (error 572006 for free text), and
  only to verified numbers.
- WhatsApp Cloud test numbers can be refused per country: Meta answers with error 130497 ("Business
  account is restricted from messaging users in this country") even for replies inside an open
  conversation. Incoming messages still arrive.
- Matrix and Mattermost can run locally in Docker (Synapse and the Mattermost preview image), so
  they need no external account.

## Start the control plane

```bash
pnpm --filter theoclaw run build
THEOCLAW_MODEL=openrouter/google/gemini-2.5-flash-lite THEOCLAW_PORT=8787 \
  THEOCLAW_CONTROL_TOKEN="$(openssl rand -hex 24)" pnpm --filter theoclaw start
```

It prints `theoclaw: control plane listening on 127.0.0.1:8787`, read from the bound socket, and
stops cleanly on Ctrl-C. `GET /health` answers `{"status":"ok"}`.

| Variable | Meaning |
|---|---|
| `THEOCLAW_MODEL` | Required. The model each turn runs. |
| `THEOKIT_API_KEY` or `OPENROUTER_API_KEY` | Required. The model key, passed to the SDK; `THEOKIT_API_KEY` wins when both are set. |
| `THEOCLAW_PORT` | Required. Digits only, 0 to 65535; 0 picks a free port. A port in use is refused by name. |
| `THEOCLAW_HOST` | Optional. The address to bind; default `127.0.0.1`. `localhost`, `::1` and `127.x.y.z` are loopback. The generic `HOST` is ignored. |
| `THEOCLAW_PUBLIC_BIND` | Must be exactly `yes` to bind a non-loopback `THEOCLAW_HOST`. The bearer token is then the whole gate. |
| `THEOCLAW_CONTROL_TOKEN` | Optional, 32 characters or more. Without it the `/control` socket is off and every upgrade answers 404. |

### The `/control` socket

Connect to `ws://127.0.0.1:<port>/control` with `Authorization: Bearer <THEOCLAW_CONTROL_TOKEN>`;
any other path answers 404 and a missing or wrong token 401, before any agent is built. Send
`{"type":"chat","message":"..."}` as a text frame. Each event of the turn arrives as
`{"type":"event","event":{...}}`, and the turn ends with exactly one `{"type":"done"}` or
`{"type":"error","code":"turn_failed"}`. A chat frame during a turn gets
`{"type":"error","code":"busy"}`, anything else `{"type":"error","code":"bad_frame"}`; neither ends
the running turn. Frames are capped at 65536 bytes.

The live check runs a real turn against the built entry:

```bash
set -a; . ~/.config/theoclaw/dev.env; set +a
pnpm --filter theoclaw run build
THEOCLAW_LIVE=1 pnpm --filter theoclaw exec vitest run tests/live/control-plane.live.test.ts
```

## Keeping secrets out of the repository

`.env` and `.env.*` are ignored at the repository root; only `.env.example` is tracked. Do not
paste token values into issues, logs or test fixtures. To check that a variable is set without
printing it: `[ -n "$THEOCLAW_TELEGRAM_TOKEN" ] && echo set`.
