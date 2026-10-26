# Changelog

All notable changes to this product are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [Semantic Versioning](https://semver.org/).

**Work done in an upstream repository is named as such.** This product is assembled from
`@theokit/*` packages, and some entries will record a change that landed in `theokit-gateways`,
`theokit-sdk` or the framework packages rather than here. Those carry the repository name.

## [Unreleased]

### Added

- Exact dependency versions and an audit of what TheoClaw installs (B-406). Every entry of
  `apps/theoclaw/package.json` is now an exact version or `workspace:*`, and `pnpm --filter theoclaw
  run check:versions` refuses any other form (`^`, `~`, `>=`, `*`, a tag, `workspace:^`, `file:`,
  `link:`, `npm:`, git), printing one `<section> <name> <specifier>` line per non-exact entry and
  exiting 1. `pnpm --filter theoclaw run audit` runs one workspace `pnpm audit --json` and exits 1
  on any advisory whose path starts at TheoClaw, dev tree included, ignoring the other importers; it
  exits 2 when pnpm's report cannot be read or an advisory in it is malformed. `vitest` and
  `@vitest/coverage-v8` move to 4.1.12, past two `@vitest/mocker` advisories, and `vite` 7.3.7 is a
  direct devDependency. The `theoclaw` CI job runs both commands.
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
  it off, and any other value stops the start. The service is withdrawn before the listener closes.
  A discovery failure writes one `TheoClawDiscoveryError` line and TheoClaw keeps serving. Finding an
  instance does not give access to it: `/control` still needs the owner's token. OC-25 stays open
  in the parity ledger until `tests/live/lan-discovery.live.test.ts` (`THEOCLAW_LIVE=1`) has a
  recorded passing run.

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
    control plane's model key, has no tool and keeps no memory: the SDK's `shell` tool is withheld and memory is off, because anyone
    who can message the bot writes the prompt (no sender allowlist yet, B-371). Every configured credential, both model keys when they are set, and
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
