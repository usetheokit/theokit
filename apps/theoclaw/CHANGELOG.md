# Changelog

All notable changes to this product are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [Semantic Versioning](https://semver.org/).

**Work done in an upstream repository is named as such.** This product is assembled from
`@theokit/*` packages, and some entries will record a change that landed in `theokit-gateways`,
`theokit-sdk` or the framework packages rather than here. Those carry the repository name.

## [Unreleased]

### Added

- `/control` agents get `run_code` and `delegate_all` (B-386). With `run_code` the agent writes a
  script that calls `read_file`, `list_dir`, `web_fetch` and `web_search` (when configured) as
  `api.<name>(input)` inside a QuickJS-WASM sandbox from `@theokit/agents/code-mode-quickjs`. Only
  the script's result reaches the model, and the file contents it read do not. Each call passes the
  same `.theokit`/`.theoclaw` veto as a direct call, and the tool's description tells the model the script is JavaScript. A script gets 10 s, 32 MiB and 16 calls, and a
  result over 16384 characters is refused with its length. With `delegate_all` the agent runs 1 to 4
  tasks at once on fresh `worker` agents that hold only the read-only tools, so a worker can neither
  run a script nor delegate. A worker that fails is reported as `delegation_failed` beside the others.
  Cancelling the `/control` turn stops both: the script and the tool call it awaits end, and each
  worker's run is cancelled and disposed, so no worker keeps spending tokens after the turn is gone.
  Chat replies still get no tool. The app pins `quickjs-emscripten-core` and
  `@jitl/quickjs-wasmfile-release-sync` at 0.32.0. The parity ledger records OC-65 and H-5 as
  shipped, checked by `tests/live/code-mode.live.test.ts`.
- A terminal UI and a desktop client of the one running instance (B-376, OC-36 desktop part, H-1).
  `/control` chat frames may name a `session`: one agent is kept per session id
  (`^[A-Za-z0-9_-]{1,64}$`), at most 16, the least recently used idle one disposed first and `busy`
  when all 16 run, all disposed when the control plane closes. `{"type":"interrupt","session"}`
  stops that session's turn (the owner gets `interrupted`, another socket `interrupt_ok`, an idle
  session `no_turn`) by aborting the signal the turn was sent with, and a socket that closes cancels
  the session turns it owns; the next chat frame on the session redirects on the same agent, and one
  sent while the cancelled turn unwinds waits up to 5 s for it. Session turns stream text as it is
  generated. Sessionless frames are unchanged. `pnpm --filter theoclaw run tui` opens an Ink TUI on
  `@theokit/tui` (multiline input, `/interrupt`, `/new`, `/quit`, tool cards, Esc to interrupt), and
  `desktop:sidecar` is the process the desktop template's shell spawns per turn; both read
  `THEOCLAW_CONTROL_TOKEN`, `THEOCLAW_PORT`, `THEOCLAW_CONNECT_HOST` (default `127.0.0.1`) and
  `THEOCLAW_SESSION` (default `owner`), build no agent, and print neither the token nor the model key.
  Upstream in this repository: `@theokit/tauri`'s `cancelCommand`, the desktop template's
  `cancel_turn`, and the timeline translator exported from `@theokit/agents/bridge`.
- Install, configure, run as a service, containerise and update TheoClaw (B-374, OC-30 to OC-34):
  - `git clone … && theokit/apps/theoclaw/install.sh` builds the app from a source checkout and
    writes the `theoclaw` launcher into `~/.local/bin` (`THEOCLAW_BIN_DIR` picks another directory).
    It never writes into Node's global directory.
  - `theoclaw onboard` asks for the model, the key (never echoed), the port, the owners and the
    workspace, or takes them as `--yes` flags with the key read from the variable
    `--api-key-env` names. It checks them the way the start does and writes
    `~/.config/theoclaw/theoclaw.env` at mode 0600. A refused value writes nothing.
  - The entry loads that file (`THEOCLAW_CONFIG` names another one), and a variable set in the
    environment wins over it.
  - `theoclaw start` runs the instance in the foreground.
  - `theoclaw daemon install|uninstall|status` runs it as a `systemd --user` unit. macOS and
    Windows are refused by name until B-692.
  - `theoclaw update [--channel stable|dev]` (`THEOCLAW_UPDATE_CHANNEL`) fast-forwards the
    checkout on `main` or `develop`, rebuilds and restarts the unit. It refuses a checkout with
    local changes or local commits.
  - `apps/theoclaw/Dockerfile` builds an image that runs as a non-root user and keeps every write
    under `/data`.
  - Installing from the npm registry waits on B-691.
- The `digest` tool of the `/control` agent (B-387, OC-66): a typed two-step workflow from
  `@theokit/sdk/workflow`, where a draft step on a fresh agent with no tool, no `shell` and memory off
  lists the key points of a text, and a second step checks them as `{ points }` (1 to 10). Each call
  writes one line, `theoclaw-workflow: digest <run id> <status> <completed>/2 steps`, without the
  text; a run that does not complete reaches the model as a tool error. Chat-reply agents hold no
  tool. The JSON-only `llm-task` step and resumable approvals are not in this release (B-677, B-678,
  B-679).
- A headless browser for `/control` agents (B-383): with `THEOCLAW_BROWSER=on` each `/control`
  agent gets the pinned `@playwright/mcp` server (0.0.83) over stdio, headless Chromium on an
  isolated profile, so it reads what a page renders with JavaScript; chat agents never get it. The
  start refuses any other value, a missing `@playwright/mcp`, `PLAYWRIGHT_BROWSERS_PATH=0`, and a
  browsers directory with no Chromium build, naming `pnpm --filter theoclaw run browser:install`,
  the new script that installs the build the server's Playwright expects. The README says how to
  give Chromium its system libraries without root (`LD_LIBRARY_PATH`). The parity ledger records
  OC-60 as shipped, checked by `tests/live/browser.live.test.ts`; OC-62 (computer use) stays open.
  The server runs under a wrapper that leaves out `browser_run_code_unsafe` (host code execution
  outside the sandbox) and starts it in a temporary directory removed on exit, so its files never
  land in the workspace; the path veto also refuses a browser `filename` into `.theokit` or
  `.theoclaw`.
- The shell's sandbox mode is the operator's choice (B-392): `THEOCLAW_SANDBOX` takes `read-only`,
  `workspace-write` (the default, as before) or `danger-full-access`, and any other value stops the
  start, with host tools off too. Under `read-only` the shell can write nothing and `write_file`,
  `edit_file` and `apply_patch` are not registered; under `workspace-write` it can write only
  `files/` and `/tmp`; under `danger-full-access` it runs unconfined, the start needs no
  bubblewrap and prints one line saying so. An unenforced sandbox under the other two modes refuses
  the start naming `THEOCLAW_SANDBOX`. The parity ledger records OC-76 as shipped, checked by
  `tests/live/sandbox.live.test.ts` against a real model; `non-main` and per-session scope wait on
  B-683. The `theoclaw` CI job installs bubblewrap for the confinement tests.
- MCP servers and ACP coding agents for the `/control` agent (B-388), named in one JSON file by
  `THEOCLAW_EXTERNAL_TOOLS`. MCP servers reach the SDK's `mcpServers` option; each ACP agent is one
  `createACPTool` from `theokit/server/agent`, run in `files/`, with every permission request
  refused. The start validates the file before any runner starts and refuses an HTTP server's
  `auth` (the SDK ignores it, B-680), `envPolicy: "all"`, a relative command or stdio `cwd`, a
  timeout that is not whole milliseconds up to 2147483647 (Node fires a longer timer after 1 ms), a server name the SDK
  would rewrite or the `browser` server already uses, an ACP name that collides with another tool
  (`run_code`, `delegate_all` and `digest` included), and, with host tools on, any ACP agent
  (it would run unsandboxed in `files/`, which the shell writes) and a file or stdio command under
  `files/` or `/tmp`. Header and env values are masked and the start prints one line naming the
  servers and agents; chat replies still get no tool. An ACP agent starts through `env -i` with only
  `PATH`, `HOME` and the locale, terminal and XDG variables, so no TheoClaw secret reaches it; its
  stderr is not masked and it has no `env` option (B-681). The parity ledger records OC-67 and OC-68 as shipped,
  checked by `tests/live/external-tools.live.test.ts`, with their missing parts filed as B-680,
  B-681, B-682, B-684 and B-685.
- The `/control` agent's tools (B-382): `read_file`, `list_dir`, `view_image`, `web_fetch` and
  `todolist` always, all from `@theokit/agents/tools` and bound to `files/` under the working
  directory; `web_search` with `BRAVE_API_KEY` (or `THEOKIT_SEARCH_API_URL` with
  `THEOKIT_SEARCH_API_KEY`); `git_diff` when `files/` is a repository and the sandbox is enforced;
  and `write_file`, `edit_file`, `apply_patch` and a bubblewrap-sandboxed `shell_exec` with
  `THEOCLAW_HOST_TOOLS=on`. The start refuses any other `THEOCLAW_HOST_TOOLS` value, host tools
  without bubblewrap, in a working directory under `/tmp` or with `THEOCLAW_STATE_DIR` under
  `files/` or `/tmp` (where the shell could rewrite `pairing.json`), a symlinked tool root, and half
  a search configuration, before any runner starts; with host tools on it prints that the shell can
  read every file the process user can read. A path into `.theokit` or `.theoclaw` and an unscoped
  `git_diff` are refused before the tool runs, the SDK's own `shell` is never offered, and chat
  replies still get no tool. The parity ledger records OC-58, OC-59 and OC-69 as shipped, checked
  by `tests/live/tools.live.test.ts`, with their missing parts filed as items; OC-63 waits on a
  search key.
- The owner reaches the control plane from another machine over an SSH local forward (B-512,
  OC-24). The README's "Remote access over SSH" section gives the command,
  `ssh -N -L 18789:127.0.0.1:<THEOCLAW_PORT> <user>@<host>`, and needs no public bind: the forward
  delivers every request from `127.0.0.1`, so `THEOCLAW_CONTROL_TOKEN` stays the whole gate, and
  `tests/remote-access-source.test.ts` fails in CI if TheoClaw's source starts reading a peer address
  or the manifest gains an SSH library. SSH is the one remote path shipped: OC-24 also names
  Tailscale serve/funnel and trusted-proxy identity, and neither is built, so the ledger's `shipped`
  row covers SSH alone. The live check (`THEOCLAW_LIVE=1`) runs a real `sshd` of its own from a temp
  directory and proves 401 without or with a wrong token, 404 with the token unset, a real-model
  turn, a reconnect with no restart, that the turn crossed that `sshd`, that no process printed the
  token, and that `~/.ssh` is untouched.
- Several instances on one host (B-514). `THEOCLAW_PROFILE=<name>` (`^[a-z0-9][a-z0-9-]{0,15}$`)
  keeps an instance's SDK state, `auth.json`, pairing store and agent working directory, with the tools' `files/` root,
  under `~/.theokit/profiles/<name>` (mode 0700), and names it `theoclaw-<name>` in its first stderr line,
  `theoclaw-<name>: instance started, profile directory <dir>`, and in its process title. A bad
  name, or a profile beside `THEOKIT_HOME`, `THEOKIT_AUTH_HOME` or `THEOCLAW_STATE_DIR`, stops the
  start with exit 1 and creates nothing. Without a profile the start is unchanged apart from its new
  first line, `theoclaw: instance started, no profile`.
- Exact dependency versions and an audit of what TheoClaw installs (B-406). Every entry of
  `apps/theoclaw/package.json` is now an exact version or `workspace:*`, and `pnpm --filter theoclaw
  run check:versions` refuses any other form (`^`, `~`, `>=`, `*`, a tag, `workspace:^`, `file:`,
  `link:`, `npm:`, git), printing one `<section> <name> <specifier>` line per non-exact entry and
  exiting 1. `pnpm --filter theoclaw run audit` runs one workspace `pnpm audit --json` and exits 1
  on any advisory whose path starts at TheoClaw, dev tree included, or at a production dependency
  of a `workspace:*` package TheoClaw links (pnpm reports those under the linked package, never
  through the app), ignoring the other importers; it exits 2 when pnpm's report or the lockfile
  cannot be read, when the lockfile has no `apps/theoclaw` importer, is not `lockfileVersion`
  9.0 or lists an importer dependency with no `version:` line (a layout the reader does not know
  fails closed instead of dropping the linked packages), or when an advisory is malformed.
  `check:versions` reads only the app's manifest: the root `pnpm.overrides` still decide what
  `zod` (`^4.6.6`) and `@theokit/sdk` resolve to, and `--frozen-lockfile` keeps that resolution
  to what the lockfile records. `vitest` and
  `@vitest/coverage-v8` move to 4.1.12, past two `@vitest/mocker` advisories, and `vite` 7.3.7 is a
  direct devDependency. The `theoclaw` CI job runs both commands.
- Only the owner talks to the instance (B-371). `THEOCLAW_OWNERS` (required) names who the
  instance serves; anyone else is refused before the agent runs, as `THEOCLAW_DM_POLICY` says:
  `pairing` (default) answers a stranger's DM with a 6-digit code the owner approves by sending
  `/approve <code>` in a DM, kept in `THEOCLAW_STATE_DIR/pairing.json`; `allowlist` answers
  `THEOCLAW_REFUSAL_TEXT`; `disabled` answers nothing; `open` lets every direct message through. A
  refused sender is answered at most once an hour and never in a group, where only owners and paired
  senders are answered under every policy, so two instances in one channel stop answering each other
  (under `open`, their direct messages still can). `THEOCLAW_GROUP_ACTIVATION` (`mention` by default) makes Slack, Mattermost,
  WhatsApp and Telegram groups answer only a mention, and an owner's `/activation` changes a Telegram
  group's mode. `THEOCLAW_BROADCAST_GROUPS` shares one bounded agent thread across channels on
  several platforms. The parity ledger records OC-18, OC-19 and OC-21 as shipped, checked against a
  real model by `tests/live/authorization.live.test.ts` (`THEOCLAW_LIVE=1`). An existing setup must
  now set `THEOCLAW_OWNERS`, and `THEOCLAW_STATE_DIR` under the default policy, or the start stops
  naming the variable. `THEOCLAW_OWNERS` and `THEOCLAW_BROADCAST_GROUPS` refuse an `email:` or
  `sms:` entry, and an e-mail or SMS sender is never an owner or paired: nothing authenticates an
  e-mail's From header or a text's caller id, so a forged one could act as the owner and `/approve`
  anyone (CWE-290). Under every policy but `open` such a sender gets no reply at all, since the
  reply would go to the address the forger wrote, and the start says so for each configured e-mail
  or SMS channel. A platform the policy does not know is never trusted.
- Chat sessions (B-378): each chat is now one continuing conversation instead of a fresh agent per
  message. A group or forum topic is one conversation for all its members; direct messages follow
  `THEOCLAW_DM_SCOPE` (`main`, `per-peer` with `THEOCLAW_PEER_LINKS`, `per-channel-peer`, the
  default, or `per-account-channel-peer` with `THEOCLAW_ACCOUNT_LABEL`). A message sent while the
  chat's turn runs is answered after it, with that turn in its history, and a conversation survives
  a restart. Sending exactly `/new` or `/reset` starts the chat afresh without a model turn.
  **`THEOCLAW_WORKSPACE` is now required**: an absolute, existing directory, under whose `.theoclaw/`
  (mode 0700) every chat's transcript and `sessions.json` are kept; under `THEOCLAW_PROFILE` the
  profile sets it to its own `workspace` and refuses an explicit one, so two profiles never share a
  conversation. Two sender ids that differ only in `-` or `_` get two conversations. Every sender who reaches the agent
  (an owner, a paired sender, and anyone under `THEOCLAW_DM_POLICY=open`, B-371) has their messages
  stored there; delete the directory while
  TheoClaw is stopped to forget every conversation. `THEOCLAW_SESSION_IDLE_MINUTES` (default 30)
  and `THEOCLAW_MAX_OPEN_SESSIONS` (default 200) bound the agents kept open. `/control` turns are
  unchanged: one agent per turn. The parity ledger records OC-50 to OC-52 as shipped, checked
  against a real model by `tests/live/sessions.live.test.ts`; OC-51 names B-596 (a SQLite session
  store) and OC-52 names B-599 (idle reset) and B-601 (steer and collect) as their gaps.
- WebChat: with `THEOCLAW_WEBCHAT_TOKEN` set (32 characters or more), the control-plane port serves
  a browser chat at `/webchat` (B-368). Build the page with `pnpm --filter theoclaw run build:web`;
  without the bundle `GET /webchat` answers 503 and names the script. The page asks for the token,
  keeps it in the tab's `sessionStorage` and sends it only as `Authorization: Bearer`; a missing or
  wrong token answers 401 before any agent is built, a post over 64 KiB answers 413, and a client
  that leaves while its post is still being read gets a 400 rather than an error in the log. Each
  message runs one agent turn streamed through `POST /webchat/chat` by the framework's route
  generator, and closing the tab mid-answer cancels the turn. WebChat keeps no conversation: each
  message reaches a fresh agent that has not seen the earlier ones, unlike a channel chat (B-378). Without the token every `/webchat` path answers 404 and the start says
  `theoclaw: webchat off (THEOCLAW_WEBCHAT_TOKEN unset)`. The token is masked in the output like
  the control token.
- A control plane: `pnpm --filter theoclaw run build && pnpm --filter theoclaw start` starts one
  process that serves HTTP and an owner WebSocket on one port (B-372). It binds `127.0.0.1` unless
  `THEOCLAW_HOST` names another address; a non-loopback address also needs
  `THEOCLAW_PUBLIC_BIND=yes`, and the generic `HOST` is never read. A busy port or an address the
  host does not have is refused by name, and the listening line is read from the socket. `GET
  /health` answers `{"status":"ok"}`. With `THEOCLAW_CONTROL_TOKEN` set (32 characters or more),
  `/control` accepts a WebSocket carrying `Authorization: Bearer <token>` and runs one agent turn
  per `{"type":"chat","message":"..."}` frame, streaming each event as `{"type":"event"}` and
  ending with exactly one `{"type":"done"}` or `{"type":"error","code":"turn_failed"}`. The start
  refuses a missing `THEOCLAW_MODEL`, model key or `THEOCLAW_PORT` before anything opens, passes
  `THEOKIT_API_KEY` or else `OPENROUTER_API_KEY` to the SDK, and exits 0 on SIGINT or SIGTERM. No
  secret is ever written to its output. Each turn's agent runs without the SDK's `shell` tool and with
  memory off, so a chat frame runs no host command and writes no transcript. The parity ledger records OC-22 and OC-23 as shipped,
  checked against a real model by `tests/live/control-plane.live.test.ts` (`THEOCLAW_LIVE=1`).
  The channel loop's webhook routes (B-369) are served by this same listener.
- LAN discovery (B-513): a TheoClaw bound to a LAN address announces itself over mDNS as one
  `_theoclaw._tcp` service whose SRV record carries the port the listener holds and whose TXT record
  holds only `path=/control`, so `avahi-browse -rt _theoclaw._tcp` or `dns-sd -B _theoclaw._tcp`
  finds it without knowing its address. A loopback bind announces nothing, `THEOCLAW_MDNS=off` turns
  it off, and any other value stops the start. The service is withdrawn before the listener closes,
  on a signal and when a caller closes the running instance itself.
  A discovery failure writes one `TheoClawDiscoveryError` line and TheoClaw keeps serving. Finding an
  instance does not give access to it: `/control` still needs the owner's token. The parity ledger
  records OC-25 as shipped, checked against a real model by `tests/live/lan-discovery.live.test.ts`
  (`THEOCLAW_LIVE=1`), whose passing run on 2026-10-26 is recorded.

- TheoClaw now replies on the ten gateway platforms (B-369).
  - `node dist/main.js` (`pnpm start`) serves the webhook routes on the control plane's listener
    (`THEOCLAW_PORT`, `127.0.0.1` unless `THEOCLAW_HOST` says otherwise) and runs one gateway runner per
    configured platform: Telegram, Discord, Slack, Matrix, Mattermost, e-mail, LINE, WhatsApp
    Cloud, Teams and SMS (Twilio). A platform runs when every one of its `THEOCLAW_*` variables is
    set; a platform missing any is skipped with one line naming the missing variables. A platform
    that cannot connect, or takes longer than 30 seconds, stops only itself.
  - Each message with text gets one agent turn and exactly one reply, in the platform's own
    rendering (`channelRendering`, from `@theokit/gateway` 0.11.0 in `theokit-gateways`). A turn
    with no visible answer replies "I could not come up with an answer to that.", and a failed
    turn replies with the presenter's error sentence. The agent runs `THEOCLAW_MODEL` with the
    control plane's model key, has no tool and keeps no memory: the SDK's `shell` tool is withheld and memory is off, because whoever
    reaches the agent writes the prompt (everyone under `THEOCLAW_DM_POLICY=open`, B-371). Every configured credential, both model keys when they are set, and
    the control token are masked as `[redacted]` in everything the process writes to stdout and stderr, including what
    the adapters write themselves.
  - Webhook platforms post to `/webhooks/line`, `/webhooks/sms`, `/webhooks/whatsapp` (GET answers
    Meta's subscription check) and `/webhooks/teams`, which answer without waiting for the agent
    turn: 200 once delivered, 400 for a malformed body, 401 for a bad signature or a refused Teams
    token, 503 while the platform has not connected or when nothing took the message (so the
    provider can retry), 500 when the delivery itself failed, 404 for a platform that is not
    configured, 405 for a wrong method, and 413 for a body over 1 MiB.
    LINE replies use the push API; no reply token is kept.
  - SIGINT or SIGTERM stops every runner, letting in-flight turns drain for up to 10 seconds each,
    then closes the server.
  - The Teams route checks each activity's token against `THEOCLAW_TEAMS_CLIENT_ID` and does not
    pin the tenant: `@theokit/gateway-teams` 0.3.0 documents that a verifier built with a tenant
    refuses every Bot Framework activity, because connector tokens carry no tenant claim.
    `THEOCLAW_TEAMS_TENANT_ID` is still required, by the Teams adapter that sends the replies.
  - No platform was verified with a live reply in this change: acceptance rests on unit and
    integration tests over fakes and local servers. Three live limitations are known: WhatsApp
    Cloud send (Meta error 130497, the business account is restricted in Brazil), SMS free text
    (Twilio trial error 572006) and Teams (no Teams tenant to test with).

- A CI job that runs this package's three gates — `test`, `typecheck`, `boundaries` — on every
  push to the trunk. `grep -rn theoclaw .github/workflows/` returned zero lines across 12 workflow
  files until now, so from B-004 onward the gates held exactly as long as somebody remembered to
  run them. Each gate is its own step, so a red run names which one failed instead of reporting
  that the job failed. It waits on `typecheck-build` and downloads the built packages, because the
  app links `@theokit/http` and `@theokit/agents` from this workspace (B-372).

- A parity ledger and the command that checks it. OBJ-6 counts 113 rows, the 106 capabilities of
  the OpenClaw inventory and the 7 Hermes rows, and until now they were counted by eye.
  `parity/ledger.json` answers each row as `open`, `out` (a reason of 8 words or more, a
  `human/<name>` declarer and a date) or `shipped` (one of this app's own test files, under
  `tests/` or `tools/` as `vitest.config.ts` collects them, declaring an `it` or `test` call whose
  title is exactly the named one, outside a comment and outside any `.skip` or `.todo`, and a
  `verified_on` date no later than today).
  `pnpm --filter theoclaw run parity` reads both source tables where they live, prints
  `shipped N · out M · open K` and one line per violation, and exits 1 while any violation
  remains. On day one it printed `shipped 0 · out 9 · open 104`. Paulo then answered the plan's
  two open questions, recorded in `parity/decisions-2026-10-06.md`: OC-37, OC-40 and H-7 are out,
  and OC-41 stays open until the terminal UI ships. The command now prints
  `shipped 0 · out 12 · open 101` and exits 1: that red run is the count. The command is not a CI
  step yet; the checker's tests run in the existing `test` step, and a new `lint` script and CI
  step run ESLint over `tools/`, which the root config's `apps/**` ignore left unread.

### Fixed

- An owner's `/approve` whose `pairing.json` write failed lost the code: the store dropped it
  before the save, and the stranger, refused for the hour, could not ask for another. A failed save
  now keeps the code until it expires, so the owner can send the same `/approve` again (B-371).
- An unreadable `pairing.json` or state directory stopped the start only after the start line was
  written and the output mask and signal handlers were installed, and nothing removed them. The
  pairing store is now loaded before any of that, so such a start fails leaving nothing behind
  (B-371).
- This app's vitest config was the only one of ten in the monorepo without a `maxWorkers` cap —
  verified independently by a reviewer, who counted the ten files and confirmed the nine. It now
  carries the same expression the other nine compute, which makes a config mismatch unreachable by
  construction.

  **What this entry claimed and could not support.** It first said the missing cap CAUSED a +55%
  regression in `vitest run tests/unit/`, citing 265.61/307.19s before registering this app in the
  root `projects` list and 417.68/469.02s after. A reviewer refuted the mechanism twice, and
  structurally rather than by re-measuring: `vitest list tests/unit/` selects zero specs from this
  project, because the filter is a path substring this app's test path does not contain — so a
  project with no specs never reaches the code a worker cap governs; and vitest 4's
  `resolveMaxWorkers` falls back to the ROOT config's value before the per-core default, and the
  root has carried 8 throughout. The interval was observed. The cause was not established, the
  post-cap runs (337.79/241.31s) spread 97s against a declared noise floor of 41.6s, and two
  samples per condition cannot tell them apart.

### Security

- A CRITICAL and a HIGH CVE shipped in this package's own declared toolchain. `vitest` was
  declared `^2.1.0` and installed 2.1.9, inside the range of `vitest <3.2.6` — "Vitest UI server
  listening, arbitrary file read and execute" — and dragged `vite <=6.4.2`'s `server.fs.deny`
  bypass with it. Measured by `pnpm audit --json`, which reported them attributable to
  `apps__theoclaw>vitest`.

  The fix is one line, and the reason it was needed is worth more than the fix: every other
  package in this monorepo declares `vitest: ^4.1.9` or `^4.1.11`. This app was the only one on
  the 2.x line, because the declaration was written without checking what the workspace uses.
  Bumped to `^4.1.9`, resolving 4.1.11; the suite passes 6/6 with no migration, since six sibling
  packages had already been running that major. Workspace criticals went 1 → 0, highs 1 → 0,
  moderates 12 → 7.

  It was found one item late. The dependency audit written for the change that introduced the
  declaration returned PASS_WITH_CAVEATS and does not contain the word `vitest`: it read
  `dependencies` and skipped `devDependencies`. That earlier verdict is left standing in its own
  file with a note pointing here, because a verdict silently corrected is a verdict nobody can
  audit.

### Fixed

- The declared build produced nothing. `package.json` declares `build: tsc -p tsconfig.json` and
  `tsconfig.json` sets `outDir: ./dist` and `declaration: true`, but `noEmit: true` is inherited
  from the root config and was never overridden — so the command exited 0 and created no `dist/`.
  Found by the phase-2 quality evaluator, which failed the phase at 0.55 rather than accept it.

- The composition root could not build the one thing it exists to build. `withAgent` resolved
  through the SYNCHRONOUS `container.resolve` while the declared factory type accepts a Promise —
  and `Agent.create`, the canonical agent factory, is async. Every real consumer would have got
  `AsyncProviderInSyncResolveError` instead of an agent. Three reviewers reached it independently by
  execution; both shipped tests used a synchronous factory, so neither tsc nor the suite could see
  it. One word: `resolveAsync`.
- Two dependency declarations that nothing on disk satisfied. `@theokit/sdk` was declared `^5.9.1`
  against a lockfile pinned to 5.9.0, and `dependency-cruiser` was declared `^16.0.0` and never
  installed — the binary that actually ran the boundary gate was the root's 17.4.3. A reviewer
  measured `pnpm install --frozen-lockfile` failing with `ERR_PNPM_OUTDATED_LOCKFILE`, which is
  CI's default here. The lockfile now resolves 5.9.1, and the redundant declaration is gone rather
  than corrected: the root already declares and installs the tool, so adding a second one was the
  parsimony violation. Under the declared major it was also worse than redundant — `16.10.4` cruises
  `0 modules, 0 dependencies` on this tree and exits 0, which is the vacuous gate the config's own
  docblock exists to prevent.

### Added

- Three tests for what the first round could not see: an async factory (RED before the fix above),
  the typed `ScopeViolationError` refusal this module's docblock rests on, and one boundary sharing
  one agent across two resolves — the behaviour that separates REQUEST from TRANSIENT, which a
  reviewer showed the original suite could not distinguish.

- A typecheck that actually reads the tests (`tsconfig.test.json`). The existing `tsconfig.json`
  excludes `tests/`, so `tsc --noEmit` resolved zero test files and a fabricated method call passed
  it silently — a reviewer found it. The new config was proven to arm before being committed.
- Architecture boundaries for this application (`.dependency-cruiser.cjs`): production must not
  import tests, and nothing may import the composition root but an entry point. The first was
  proven to fire by a deliberate violation. The second could not be: `src/` holds one file and the
  rule's own lookahead excludes it, so its source set is empty today. A reviewer measured that and
  a second confirmed it — the sentence that stood here claimed both, and only the commit message
  was accurate.
- A third test pinning the composition root's surface to exactly one key, which is what makes
  "no caller can resolve outside a request" true by construction rather than by a guard.

- The composition root (`src/composition.ts`) — the first code in this application. It exposes a
  request BOUNDARY rather than a resolve, because the container refuses a REQUEST-scoped resolve
  outside one with a typed error, and a boundary opened per resolve would make "one agent per
  request" mean "one agent per call" (B-004).
- The application's TypeScript and test configuration, and its four runtime dependencies. They are
  installed from the registry rather than linked: `theokit-di` is a sibling repository outside this
  workspace, and `pnpm-workspace.yaml` states the rule for exactly that case.

- The maintenance registry: `BACKLOG.md`, created after `cycle-brainstorm` returned
  `PRODUCT_ALIGNED`. Honestly empty — the ten technical pieces are what the product is made of,
  not work somebody filed, and seeding them would manufacture items with no `why_now` and no
  owner. Routing resolves for two domains (`theoclaw`, `theokit`) with the specialist on disk.

- Ten registered items, B-001 to B-010 — seven for the pieces the signed cascade committed and
  has not started, three for rows OBJ-6 declares unmeasured. Each carries a `why_now` naming what
  changed here (the signature, the all-ten platform decision, a delivered sibling piece), a
  verifiable DoD, and `blocked_by` where a decision or another repository is genuinely in the way.
  No item was derived from a piece alone.

- The product scope exists: `apps/theoclaw`, a workspace member under the monorepo's root
  toolchain. Nothing is implemented yet — this entry records the scope root that
  `cycle-brainstorm` requires before a product vision can be written (Unbreakable Rule 6).
- The four product documents, written from an interview rather than derived: what TheoClaw is
  and is explicitly not, five objectives each carrying a metric and a horizon, seven
  requirements each serving an objective, and eight technical pieces each realising a
  requirement. `.squad/wiki/product/`. Unsigned — the alignment gate scores 100% of what a
  script can check and refuses to sign the part it cannot.
