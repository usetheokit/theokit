# TheoClaw

A personal AI assistant that lives where its user already writes: one agent answering on Telegram,
Discord, Slack, Matrix, Mattermost, e-mail, LINE, WhatsApp, Microsoft Teams and SMS.

## Install

```bash
git clone https://github.com/usetheokit/theokit.git theokit && theokit/apps/theoclaw/install.sh
```

It needs `git` and Node 22 or later, and network access to the npm registry. The script installs
and builds TheoClaw and its workspace packages in the clone, then writes the launcher
`~/.local/bin/theoclaw` (`THEOCLAW_BIN_DIR` picks another directory). It says so when that
directory is not on your `PATH`. With no `pnpm` installed, it puts corepack's `pnpm` in
`~/.local/share/theoclaw/bin` for the build. It never writes into Node's global directory. Running
it again rebuilds and rewrites the same launcher. Publishing to the npm registry is not available
yet.

Then write the configuration and start:

```bash
theoclaw onboard     # asks for the model, the key (not shown), the port, the owners and the workspace
theoclaw start
```

`theoclaw onboard --yes --model <id> --api-key-env <NAME> --port <n> --owners <platform:id,...>`
does the same without prompts, and reads the key from the variable `--api-key-env` names. The key
never goes on the command line. The file is `~/.config/theoclaw/theoclaw.env` (mode 0600, in a
0700 directory), or `theoclaw-<profile>.env` with `THEOCLAW_PROFILE`, or the path in
`THEOCLAW_CONFIG`. A variable set in the environment wins over the file. Onboarding checks every
value the way the start does and writes nothing when one is refused. It keeps an existing file
unless you pass `--force`.

## Run as a service

```bash
theoclaw daemon install     # writes ~/.config/systemd/user/theoclaw.service, enables and starts it
theoclaw daemon status      # exit 0 when the unit is active, 3 otherwise
theoclaw daemon uninstall   # stops, disables and removes the unit
```

The unit runs `node <checkout>/apps/theoclaw/dist/main.js` with `THEOCLAW_CONFIG` set to the
configuration file's absolute path, in the configured `THEOCLAW_WORKSPACE`, and restarts on
failure. With `THEOCLAW_PROFILE` set, it is `theoclaw-<profile>.service`, and several profiles run
side by side. `install` refuses when the configuration file or the build is missing.

A user unit stops when you log out unless lingering is on. `install` prints the command when it is
off: `loginctl enable-linger "$USER"`. Only Linux with `systemd --user` is supported: macOS
(launchd) and Windows are refused by name.

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
| `THEOCLAW_MODEL` | Model id the agent runs, e.g. `openrouter/google/gemini-2.5-flash-lite`. There is no default: startup fails and names the variable. |
| `THEOKIT_API_KEY` or `OPENROUTER_API_KEY` | The model key, passed to the SDK; `THEOKIT_API_KEY` wins when both are set. |
| `THEOCLAW_PORT` | Port of the one listener that serves the webhook routes, `/health` and `/control`. Digits only, 0 to 65535. |
| `THEOCLAW_STATE_DIR` | Where pairings are kept. Required under the default `THEOCLAW_DM_POLICY=pairing`; see below. |
| `THEOCLAW_OWNERS` | Who the instance serves: comma-separated `platform:senderId`, e.g. `telegram:42,matrix:@me:matrix.org`. Required even with no platform configured; see [Who may talk to the instance](#who-may-talk-to-the-instance). |
| `THEOCLAW_WORKSPACE` | Absolute path of an existing directory. Each chat's transcript and the session generations are kept under `<THEOCLAW_WORKSPACE>/.theoclaw/` (created with mode 0700). Startup fails and names the variable when it is unset, relative or not a directory. Under `THEOCLAW_PROFILE` the profile sets it to its own `workspace` and an explicit value is refused (see [Several instances on one host](#several-instances-on-one-host)). |

### Who may talk to the instance

Only the owners in `THEOCLAW_OWNERS`, and the senders an owner pairs, reach the agent. Everyone else
is refused before the agent runs. In a group a refused sender never gets a reply, under every
policy below; owners and paired senders are answered there as in a direct message.

| Variable | Meaning |
|---|---|
| `THEOCLAW_OWNERS` | Required. `platform:senderId` entries, comma-separated; the platform is one of the ten below, and an id may contain colons (Matrix). An `email:` or `sms:` entry is refused: nothing authenticates the From header of an e-mail or the caller id of a text, so anyone could write as the owner. For the same reason an e-mail or SMS sender is never an owner or paired, and under every policy but `open` gets no reply at all, since the reply would go to whatever address the sender wrote; the start says so for each such channel configured. |
| `THEOCLAW_DM_POLICY` | What a direct message from anyone else gets: `pairing` (default) a pairing code, `allowlist` the refusal text, `disabled` nothing, `open` the agent. A refused sender is answered at most once an hour; after that, silence. |
| `THEOCLAW_STATE_DIR` | Directory holding `pairing.json` (mode 0600, the directory created 0700). Required under `pairing`, optional otherwise; pairings made earlier still apply when it is set. A `pairing.json` that does not parse stops the start. With `THEOCLAW_HOST_TOOLS=on` it may not lie under `files/` or `/tmp`, which the sandboxed shell can write. |
| `THEOCLAW_REFUSAL_TEXT` | The refusal under `allowlist`. Default `This assistant answers its owner only.` |
| `THEOCLAW_GROUP_ACTIVATION` | Slack, Mattermost, WhatsApp and Telegram only: `mention` (default) answers a group message only when it mentions the bot; `always` answers every message from an owner or a paired sender. The other six platforms answer an owner or a paired sender in a group either way. |
| `THEOCLAW_BROADCAST_GROUPS` | Channels that share one agent thread: `name=platform:channelId,platform:channelId;name2=...`. Each group needs two channels or more, a channel belongs to one group, and an `email:` or `sms:` channel is refused for the reason above. The thread keeps the last 20 turns, at most 16384 characters, and every answer reaches every member channel. |

**Pairing.** Under `pairing` a stranger's first direct message is answered with a 6-digit code,
valid for one hour. The owner approves it by sending `/approve <code>` to the bot in a direct
message; the sender is then paired, across restarts.

**Group activation.** Slack, Mattermost and WhatsApp read the mode at start. On Telegram an owner
can send `/activation mention` or `/activation always` in a group to change that group's mode until
the instance restarts.

**`open` lets two instances talk to each other.** Under `pairing`, `allowlist` and `disabled`, two
TheoClaw instances in one channel stop after at most two direct messages and never reply in a
group, because neither is the other's owner. Under `open` both answer every direct message, so two
instances can keep answering each other's DMs on the seven platforms whose adapters do not drop a
message written by another bot. Choose `open` only for an instance no other bot writes to.

### Chat sessions

Every chat is one continuing conversation, kept across messages and across restarts: a group or a
forum topic is one conversation for all its members, and a direct message follows
`THEOCLAW_DM_SCOPE`. A message sent while the chat's previous turn still runs is answered after it,
with that turn in its history. Sending exactly `/new` or `/reset` starts the chat afresh: TheoClaw
answers `Started a new conversation.` and runs no model turn; the earlier transcript stays on disk.

| Variable | Meaning |
|---|---|
| `THEOCLAW_DM_SCOPE` | How direct messages are grouped: `main` (one conversation for every direct message), `per-peer` (one per person, across platforms, through `THEOCLAW_PEER_LINKS`), `per-channel-peer` (the default: one per platform and sender) or `per-account-channel-peer` (the same, keyed with `THEOCLAW_ACCOUNT_LABEL` as well). |
| `THEOCLAW_PEER_LINKS` | `<platform>:<senderId>=<name>` pairs separated by commas; senders linked to one name share a session under `per-peer`. A name holds letters, digits and underscores. |
| `THEOCLAW_ACCOUNT_LABEL` | Required by `per-account-channel-peer`. |
| `THEOCLAW_SESSION_IDLE_MINUTES` | Minutes a chat's agent stays open with no turn, 1 to 1440, default 30. Its conversation is kept: the next message resumes it from disk. |
| `THEOCLAW_MAX_OPEN_SESSIONS` | Chat agents kept open at once, 1 to 10000, default 200; above it the least recently used idle one is closed. |

**What is stored, and who can write it.** Every sender who reaches the agent starts a conversation:
an owner, a paired sender, and under `THEOCLAW_DM_POLICY=open` anyone who can message the bot. Every
message and reply is kept in
`<THEOCLAW_WORKSPACE>/.theoclaw/`. Chat agents still run without the `shell` tool and with memory
off. To forget every conversation, stop TheoClaw and delete that directory.

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
be reachable from the internet. The listener binds `127.0.0.1` by default, so a tunnel is the
simplest way, for example a Cloudflare named tunnel pointing a stable hostname at
`http://localhost:$THEOCLAW_PORT`. Binding a public address instead takes `THEOCLAW_HOST` and
`THEOCLAW_PUBLIC_BIND=yes` (see below), and exposes `/health` and `/control` on it too. Register
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

### LAN discovery

A TheoClaw bound to a LAN address (`THEOCLAW_HOST` with `THEOCLAW_PUBLIC_BIND=yes`) announces itself
over mDNS as one DNS-SD service of type `_theoclaw._tcp`, named `TheoClaw on <host> port <port>`. Its
SRV record carries the port the listener holds, and its TXT record holds only `path=/control`. A
TheoClaw bound to a loopback address announces nothing, and a stopped one withdraws its service
before the listener closes.

| Variable | Meaning |
|---|---|
| `THEOCLAW_MDNS` | `off` turns discovery off; unset, empty or `on` leaves it on. Any other value stops the start and names the variable. |

Browse for it from another machine on the same network:

```bash
avahi-browse -rt _theoclaw._tcp   # Linux
dns-sd -B _theoclaw._tcp          # macOS
```

Finding an instance does not give access to it: `/control` still needs the owner's token
(`THEOCLAW_CONTROL_TOKEN`). The A records list the host's addresses, which can include an interface
the listener is not bound to; connect to the address the instance was started on. A discovery
failure (for example, a host that cannot send multicast) writes one `TheoClawDiscoveryError` line,
and TheoClaw keeps serving on its address.

## Start TheoClaw

```bash
pnpm --filter theoclaw run build
mkdir -p ~/theoclaw-workspace
THEOCLAW_MODEL=openrouter/google/gemini-2.5-flash-lite THEOCLAW_PORT=8787 \
  THEOCLAW_WORKSPACE=~/theoclaw-workspace \
  THEOCLAW_CONTROL_TOKEN="$(openssl rand -hex 24)" pnpm --filter theoclaw start
```

It prints `theoclaw: control plane listening on 127.0.0.1:8787`, read from the bound socket, starts
one gateway runner per configured platform, and stops cleanly on Ctrl-C: the runners first, then
the listener. `GET /health` answers `{"status":"ok"}`.

| Variable | Meaning |
|---|---|
| `THEOCLAW_MODEL` | Required. The model each turn runs. |
| `THEOKIT_API_KEY` or `OPENROUTER_API_KEY` | Required. The model key, passed to the SDK; `THEOKIT_API_KEY` wins when both are set. |
| `THEOCLAW_PORT` | Required. Digits only, 0 to 65535; 0 picks a free port. A port in use is refused by name. |
| `THEOCLAW_WORKSPACE` | Required. An absolute, existing directory; chat sessions are kept under its `.theoclaw/`. |
| `THEOCLAW_HOST` | Optional. The address to bind; default `127.0.0.1`. `localhost`, `::1` and `127.x.y.z` are loopback. The generic `HOST` is ignored. |
| `THEOCLAW_PUBLIC_BIND` | Must be exactly `yes` to bind a non-loopback `THEOCLAW_HOST`. The bearer token is then the whole gate. |
| `THEOCLAW_CONTROL_TOKEN` | Optional, 32 characters or more. Without it the `/control` socket is off and every upgrade answers 404. |
| `THEOCLAW_WEBCHAT_TOKEN` | Optional, 32 characters or more. Without it `/webchat` is off and every `/webchat` path answers 404. |

### The `/control` socket

Connect to `ws://127.0.0.1:<port>/control` with `Authorization: Bearer <THEOCLAW_CONTROL_TOKEN>`;
any other path answers 404 and a missing or wrong token 401, before any agent is built. Send
`{"type":"chat","message":"..."}` as a text frame. Each event of the turn arrives as
`{"type":"event","event":{...}}`, and the turn ends with exactly one `{"type":"done"}` or
`{"type":"error","code":"turn_failed"}`. A chat frame during a turn gets
`{"type":"error","code":"busy"}`, anything else `{"type":"error","code":"bad_frame"}`; neither ends
the running turn. Frames are capped at 65536 bytes.

Each turn's agent is built without the SDK's `shell` tool and with memory off, so a chat frame runs
no command on the host and leaves no transcript on disk. A `/control` turn is one agent of its own,
never a chat session's. The SDK still adds one entry per turn to
`.theokit/agents/registry.json` under the process's working directory; no option turns that off.

### The `/control` agent's tools

The `/control` turn's agent gets tools built only from `@theokit/agents/tools`, bound to the tool
root `files/` under the process's working directory, or a profiled instance's workspace (created at start with mode 0700; a symlinked
or non-directory `files` is refused). Chat replies get no tool: anyone who can message the bot
writes their prompt.

| Tool | When |
|---|---|
| `read_file`, `list_dir`, `view_image`, `web_fetch`, `todolist` | always |
| `web_search` | with `BRAVE_API_KEY`, or with both `THEOKIT_SEARCH_API_URL` and `THEOKIT_SEARCH_API_KEY` |
| `git_diff` | when `files/` is itself a git repository and the sandbox is enforced |
| `shell_exec` | with `THEOCLAW_HOST_TOOLS=on` |
| `write_file`, `edit_file`, `apply_patch` | with `THEOCLAW_HOST_TOOLS=on`, unless `THEOCLAW_SANDBOX=read-only` |

`THEOCLAW_HOST_TOOLS` is `on` or unset; any other value is refused. With it on, under the default
`THEOCLAW_SANDBOX=workspace-write` (the modes are below), the shell runs in a bubblewrap sandbox
that can write only `files/` and `/tmp`, and the start refuses when bubblewrap
is not available, when the working directory lies under `/tmp`, or when `THEOCLAW_STATE_DIR` lies
under `files/` or `/tmp` (symlinks followed), where the shell could rewrite `pairing.json` and pair
any sender. **The sandboxed shell can still
read every file the process user can read**; the start prints a line saying so. A tool path that
resolves into `.theokit` or `.theoclaw` beside `files/` is refused before the tool runs, and so is
a `git_diff` with no path. The SDK's own unsandboxed `shell` is never offered. Search keys are
masked in the output like every other credential. A start line says when web search is off, and
when `git_diff` is off because the sandbox is not enforced.

`THEOCLAW_SANDBOX` chooses the shell's sandbox when host tools are on (B-392). Any other value
stops the start before any runner, with host tools off too.

| Mode | The shell can write | The file-writing tools |
|---|---|---|
| `read-only` | nothing | not registered: they take no sandbox, so only leaving them out keeps the mode true |
| `workspace-write` (default) | `files/` and `/tmp`, which the SDK keeps writable | registered |
| `danger-full-access` | every path the process user can write: no sandbox | registered |

Under `read-only` and `workspace-write` the start refuses when the sandbox is not enforced, naming
`THEOCLAW_SANDBOX` and the reason, and keeps the `/tmp` and `THEOCLAW_STATE_DIR` refusals above.
Under `danger-full-access` it starts without bubblewrap, under `/tmp` too, and prints
`sandbox: off (danger-full-access), shell_exec runs unconfined`; `git_diff` stays off. With host
tools off the shell is not registered and every mode keeps a read-only sandbox.

The live check of the sandbox (`THEOCLAW_MODEL` set in the environment):

```bash
THEOCLAW_LIVE=1 pnpm --filter theoclaw exec vitest run tests/live/sandbox.live.test.ts
```

The live check of the tools:

```bash
set -a; . ~/.config/theoclaw/dev.env; set +a
THEOCLAW_LIVE=1 THEOCLAW_HOST_TOOLS=on pnpm --filter theoclaw exec vitest run tests/live/tools.live.test.ts
```

### The `/control` agent's browser

With `THEOCLAW_BROWSER=on`, `/control` agents also get a headless Chromium through the pinned
`@playwright/mcp` server, spawned over stdio with an isolated profile per session. Its tools reach
the model as `mcp_browser_<tool>` (`mcp_browser_browser_navigate`, `mcp_browser_browser_snapshot`
and the others the server lists), so the agent can read what a page renders with JavaScript, which
`web_fetch` cannot. Chat agents never get it. The browser can open any URL the process can reach,
loopback services included, which is why it is off unless set.

| Variable | Meaning |
|---|---|
| `THEOCLAW_BROWSER` | `on` or unset; any other value is refused. With `on` the start refuses, naming the fix, when `@playwright/mcp` does not resolve or no Chromium build is in the browsers directory. |
| `PLAYWRIGHT_BROWSERS_PATH` | Optional. Where Playwright keeps its browsers; default `~/.cache/ms-playwright`. `0` (browsers inside the package) is refused. |

Install the Chromium build the server's own Playwright expects, once per host:

```bash
pnpm --filter theoclaw run browser:install
```

**Chromium also needs system libraries.** On a host without them the start still succeeds (it
checks that the build is installed, not that it can run), and the first browser call returns a
tool error naming the missing library, e.g. `libatk-1.0.so.0: cannot open shared object file`.
With root, `sudo npx playwright install-deps chromium` installs them. Without root, unpack the
distribution's packages into a directory of your own and point the loader at it; on Ubuntu 24.04
the browser needed these:

```bash
mkdir -p ~/.cache/chromium-user-libs/debs && cd ~/.cache/chromium-user-libs/debs
apt-get download libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libxrender1 libxi6 libgbm1 libasound2t64 libcups2t64 libcairo2 \
  libpango-1.0-0 libavahi-common3 libavahi-client3 libxcb-render0 libxcb-shm0 libpixman-1-0 \
  libthai0 libdatrie1 libharfbuzz0b libgraphite2-3
for deb in *.deb; do dpkg-deb -x "$deb" x; done
cp -a x/usr/lib/x86_64-linux-gnu/. ~/.cache/chromium-user-libs/
LD_LIBRARY_PATH=~/.cache/chromium-user-libs ldd ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome | grep 'not found'
```

The last line prints nothing when every library is found. Start TheoClaw, or run the live check,
with `LD_LIBRARY_PATH=~/.cache/chromium-user-libs` set: the server inherits it and Chromium loads
from it. The libraries are host state; the repository carries none of them.

The live check of the browser needs a model that calls the server's tools by their advertised
names: `openrouter/google/gemini-2.5-flash` does, while `gemini-2.5-flash-lite` drops the
`mcp_browser_` prefix and gets `Unknown tool`.

```bash
set -a; . ~/.config/theoclaw/dev.env; set +a
LD_LIBRARY_PATH=~/.cache/chromium-user-libs PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright \
  THEOCLAW_LIVE=1 THEOCLAW_MODEL=openrouter/google/gemini-2.5-flash \
  pnpm --filter theoclaw exec vitest run tests/live/browser.live.test.ts
```

### MCP servers and ACP agents

`THEOCLAW_EXTERNAL_TOOLS` names one JSON file of MCP servers and ACP coding agents for the
`/control` agent; chat replies still get none of them. The start reads and validates the file
before any runner starts, and refuses it naming the file and the key:

```json
{
  "mcpServers": {
    "docs": { "url": "https://docs.example/mcp", "headers": { "Authorization": "Bearer <token>" } },
    "files": { "command": "/usr/local/bin/files-mcp", "args": ["--root", "/srv/files"] }
  },
  "acpAgents": [
    { "name": "coder", "description": "A coding agent; send it a task.", "command": "/usr/local/bin/coder-acp", "timeoutMs": 600000 }
  ]
}
```

- An MCP server with `url` is HTTP (`type` `http` or `sse`), anything else stdio. The SDK names
  its tools `mcp_<server>_<tool>`, so a server name must match `^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$`,
  and may not be `browser`, the server `THEOCLAW_BROWSER=on` adds beside them.
- An HTTP server's `auth` is refused: `@theokit/sdk` 5.11.0 would send the request without the
  credentials and say nothing (B-680). Put the token in `headers`, and put only credential values
  there and in `env`: every header and env value of 8 characters or more is masked in the output.
- `envPolicy: "all"` is refused, so a stdio server never inherits the model key; the SDK's default
  drops secret-like variables and `env` adds what the server needs.
- A `command` with a `/` must be absolute; a bare name is looked up on `PATH`.
- Each ACP agent is one tool named `name`, a `createACPTool` from `theokit/server/agent` run in
  `files/`, one process per call. Its name may not be a TheoClaw tool's (`run_code`, `delegate_all` and `digest` included), a name the SDK reserves
  (`shell`, `memory_search`, `memory_get`), or start with `mcp_`. Every permission it asks for is
  refused (asking the owner is B-684). That stops only what the agent asks about: it runs as the
  TheoClaw user, outside the tool sandbox, and an agent that writes without asking (its own
  auto-accept mode or project settings) is not stopped by it.
- **An ACP agent inherits the environment of the TheoClaw process**, channel tokens included, and
  its stderr is not masked: an `env` option and a piped stderr are B-681. Run only agents you would
  trust with those values.
- With `THEOCLAW_HOST_TOOLS=on` the file, every absolute stdio `command` and every stdio `cwd` may
  not lie under `files/` or `/tmp`, where the shell could rewrite what the next start spawns, and
  ACP agents are refused: each runs unsandboxed in `files/`, which the shell can write. A stdio
  server is a host process outside the tool sandbox.

The start prints one line naming them, e.g. `tools: external: 2 MCP servers (docs, files), 1 ACP
agent (coder)`. The live check runs a stdio MCP fixture and a fixture ACP agent on a real model:

```bash
THEOCLAW_LIVE=1 pnpm --filter theoclaw exec vitest run tests/live/external-tools.live.test.ts
```

The live check runs a real turn against the built entry:

```bash
set -a; . ~/.config/theoclaw/dev.env; set +a
pnpm --filter theoclaw run build
THEOCLAW_LIVE=1 pnpm --filter theoclaw exec vitest run tests/live/control-plane.live.test.ts
```

### WebChat

WebChat is a browser chat with the agent, served on the same port. Build the page once, then start
TheoClaw with `THEOCLAW_WEBCHAT_TOKEN` set:

```bash
pnpm --filter theoclaw run build
pnpm --filter theoclaw run build:web
pnpm --filter theoclaw start
```

Open `http://127.0.0.1:<port>/webchat` and enter the token. The page keeps it in the tab's
`sessionStorage` and sends it only in the `Authorization: Bearer` header, never in a URL. Each
message runs one agent turn, streamed through `POST /webchat/chat`; a missing or wrong token answers
401 before any agent is built, and a post over 64 KiB answers 413. WebChat keeps no conversation:
each message reaches a fresh agent that has not seen the earlier ones, although the page shows them
as one thread (channel chats keep theirs, B-378). The page and its two assets carry no secret and are served without the
token. Closing the tab mid-answer cancels the turn. Without `build:web`,
`GET /webchat` answers 503 and names the script. `build:web` writes `dist/web/assets/app.js` and
`app.css`, and fails when the two exceed 3 MiB.

The live check runs a real WebChat turn against the built entry, through the page's own transport
configuration:

```bash
set -a; . ~/.config/theoclaw/dev.env; set +a
pnpm --filter theoclaw run build && pnpm --filter theoclaw run build:web
THEOCLAW_LIVE=1 pnpm --filter theoclaw exec vitest run tests/live/webchat.live.test.ts
```

## Remote access over SSH

TheoClaw binds `127.0.0.1` by default, and TheoClaw needs no public bind for this: to reach the
control plane from another machine, forward a local port to it over SSH. On the machine you type
on, with `THEOCLAW_PORT` the port the instance prints on its listening line:

```bash
ssh -N -L 18789:127.0.0.1:<THEOCLAW_PORT> <user>@<host>
```

Then connect to `ws://127.0.0.1:18789/control` with `Authorization: Bearer <THEOCLAW_CONTROL_TOKEN>`,
as in [The `/control` socket](#the-control-socket). `THEOCLAW_CONTROL_TOKEN` must be set on the
instance: without it every upgrade answers 404, through the forward or not. The command assumes
the default `127.0.0.1`; with another loopback `THEOCLAW_HOST` (`::1`, `127.x.y.z`), forward to that
address instead.

Every request a forward delivers arrives from `127.0.0.1`, so the bearer token is the whole gate,
and no TheoClaw route grants anything to a loopback peer (`tests/remote-access-source.test.ts`
fails if TheoClaw's source starts reading `remoteAddress` or a forwarding header). Closing the forward and opening a new one needs no
restart. SSH is the one supported remote path: Tailscale serve or funnel and a trusted proxy that
passes the user's identity in a header are not supported.

The live check runs a real `sshd` of its own from a temp directory, never the host's and never
`~/.ssh`, and needs `ssh`, `sshd` and `ssh-keygen` on `PATH`:

```bash
set -a; . ~/.config/theoclaw/dev.env; set +a
THEOCLAW_LIVE=1 pnpm --filter theoclaw exec vitest run tests/live/remote-access.live.test.ts
```

## Several instances on one host

Set `THEOCLAW_PROFILE` to run more than one TheoClaw on one machine, each with its own state and its
own name. The value is a name matching `^[a-z0-9][a-z0-9-]{0,15}$` (for example `work` or `home-2`);
anything else stops the start with exit 1 and creates nothing. Give each instance its own
`THEOCLAW_PORT` and its own bot credentials.

With `THEOCLAW_PROFILE=work` the instance:

- keeps everything under `~/.theokit/profiles/work` (directory mode 0700): it sets `THEOKIT_HOME`
  and `THEOKIT_AUTH_HOME` to that directory, so the SDK's turn records, settings and `auth.json` go
  there, and `THEOCLAW_STATE_DIR` to `~/.theokit/profiles/work/state`, so `pairing.json` does too
  (a profiled instance always has a pairing store, empty until its owner approves someone);
- builds its agents in `~/.theokit/profiles/work/workspace`, so the agent registry and any memory
  under the working directory stay in the profile. It sets `THEOCLAW_WORKSPACE` to that directory,
  so every chat's transcript and `sessions.json` are kept in its `.theoclaw/` too, and two profiles
  never share a conversation. That directory is also the agent's working
  directory: tools and project configuration resolve against it, not against the directory you
  started TheoClaw in;
- calls itself `theoclaw-work`. Its first line on stderr is
  `theoclaw-work: instance started, profile directory /home/<you>/.theokit/profiles/work`, which is
  the authoritative label. The process title (`ps`) is set to the same name, but the kernel
  truncates it to the length of the original command line, so it can be cut short.

A profile cannot be combined with an explicit `THEOKIT_HOME`, `THEOKIT_AUTH_HOME`,
`THEOCLAW_STATE_DIR` or `THEOCLAW_WORKSPACE`: the start stops and names each one set. Unset them before moving to profiles.
Restarting an instance with the same profile keeps everything it wrote before. With no
`THEOCLAW_PROFILE`, nothing moves and the first line is `theoclaw: instance started, no profile`.

```bash
THEOCLAW_PROFILE=work THEOCLAW_PORT=8787 ... pnpm --filter theoclaw start
THEOCLAW_PROFILE=home THEOCLAW_PORT=8788 ... pnpm --filter theoclaw start
```

The live check starts two built instances under one scratch `HOME` and runs a real-model turn on
each:

```bash
pnpm --filter theoclaw run build
THEOCLAW_LIVE=1 pnpm --filter theoclaw exec vitest run tests/live/instance-profiles.live.test.ts
```

## Keeping secrets out of the repository

`.env` and `.env.*` are ignored at the repository root; only `.env.example` is tracked. Do not
paste token values into issues, logs or test fixtures. To check that a variable is set without
printing it: `[ -n "$THEOCLAW_TELEGRAM_TOKEN" ] && echo set`.
