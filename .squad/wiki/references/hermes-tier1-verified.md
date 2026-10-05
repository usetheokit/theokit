# Hermes Tier 1 — the five areas a TheoClaw decision was waiting on, exercised

**Source:** `github.com/NousResearch/hermes-agent`, MIT, Copyright (c) 2025 Nous Research.
**v0.21.3 (2026.9.14)**, installed and configured against OpenRouter
(`anthropic/claude-sonnet-4.5`).

**Every claim below was produced by RUNNING the installed binary**, 2026-09-17. Where a claim
rests on reading instead, it says so. Three claims elsewhere in this front came from reading and
were wrong; that is why this note is structured around what was executed.

## 1. `cron` — autonomy, verified end to end

**Created, triggered and confirmed in the durable record:**

```
hermes cron create "30m" "<prompt>" --name parity-probe --deliver local
  → Created job: a4e86afa65be   Next run: 2026-09-17T20:57:48-03:00
  ⚠ Gateway is not running — jobs won't fire automatically.
hermes cron run a4e86afa65be   → Ran now: succeeded.
hermes cron runs a4e86afa65be  → b87cb473… completed  source=direct  2026-09-17T20:27:59
```

The run also appears in the session store as `cron_a4e86afa65be_20260917_202801` — **a scheduled
run is a first-class session**, not a side effect.

**What the surface carries that matters for design:**

| Flag / verb | Why it is a decision, not a feature |
|---|---|
| `--continuity` | *"Each run wakes up with the job's own previous output"* — a scheduled job with its own memory across runs |
| `--no-agent` | run a script on schedule with **no LLM at all** — the scheduler is useful without inference |
| `--deliver` / `--failure-deliver` | success and failure can go to **different** destinations |
| `notepad` | durable KV that survives across runs, per job |
| `incidents` | durable failure records **with acknowledgement** — a failure is a tracked object |
| `resnap` | adopt the current model resolution for unpinned jobs without pinning them |
| `--monitor-script` / `--monitor-url` | the job can be watched by something outside it |

**And `source=direct` in the run record** distinguishes a manual trigger from a scheduled fire. An
audit can tell why a job ran.

**For TheoClaw:** none of the nine PIECEs covers scheduled work. `--continuity`, `--no-agent` and
the incident ledger are three separate decisions, and only the first is obvious.

## 2. `profile` — isolation, verified by behaviour rather than by directory listing

```
hermes profile create parity-test
hermes --profile parity-test -z "What language do I write commit messages in? …"
  → UNKNOWN.
```

The `default` profile answers that question correctly **from memory it curated itself**. The new
profile answers UNKNOWN. **The isolation is real and it was proven with the agent, not with `ls`.**

On disk each profile is a full parallel tree: `memories/ sessions/ skills/ cron/ hooks/ plans/
workspace/ skins/ pairing/ logs/ config.yaml SOUL.md`. Each also gets a **wrapper script** on PATH
(`~/.local/bin/parity-test`), so the profile is a command, not a flag you must remember.

**Two findings that are not in the directory listing:**

- **Isolation is not absolute, and they say so:** *"This profile has no API keys yet… or it will
  inherit keys from your shell environment."* Environment leaks across the boundary by design.
- **`purge-identity` and `migrate-identity` exist as retryable verbs.** Deleting or renaming a
  profile must clean up **session and routing identity**, that can fail, and they made the cleanup
  re-runnable rather than assuming it worked.

**For TheoClaw:** one instance per person was decided; profiles are the *other* axis — one person,
several isolated agents. It decides whether `~/.theoclaw` is one root or many, and nothing in the
nine PIECEs takes that decision.

## 3. Session durability — the 26 `hermes_state_*` modules, exercised from the outside

**Cross-session FTS5 recall, proven in a separate process:**

```
hermes -z "Use session_search to find what I said about PARITY-PROBE-OK earlier…"
  → You said: "Reply with exactly: PARITY-PROBE-OK"
    Session: @session:default/20260917_201846_f8a50b
```

**The address carries the profile** (`default/`), so session identity is profile-scoped — which is
what `migrate-identity` in §2 exists to maintain.

The `sessions` surface: `list export delete prune archive optimize clean-markers optimize-storage
repair repair-routing recover stats rename pin unpin pinned retitle-skills browse import`.

**Three of those are recovery** — `repair`, `repair-routing`, `recover`. A store with three
distinct recovery verbs is a store whose authors expect corruption and built for it. `optimize` is
*"merge FTS5 segments + VACUUM (no data change)"*; `optimize-storage` migrates the index layout.

**Titles are generated, and that connects two separate observations:** every session carries a
title, and the `--usage-file` report showed `auxiliary.by_task: title_generation` costing
$0.001467. The convenience has a line item.

**For TheoClaw:** OBJ-4 covers what the agent remembers about the user. **Nothing covers what a
session preserves about itself** — compression, rewind (`/undo`, `/retry`), WAL, repair,
portability. That is a second axis, and it is unclaimed.

## 4. `mcp` — both directions, and the server direction is not what it looks like

**Client:** `add remove list test configure login reauth picker catalog install`. `configure`
toggles **tool selection per server** — which matters because of §"prompt budget" below.
`catalog` is a Nous-approved one-click list, i.e. a curated distribution channel.

**Server — verified by protocol handshake, not by reading:**

```
echo '{"jsonrpc":"2.0","id":1,"method":"initialize",…}' | hermes mcp serve
  → {"result":{"protocolVersion":"2024-11-05","capabilities":{"prompts":…,"resources":…,"tools":…},
     "instructions":"Hermes Agent messaging bridge. Use these tools to interact with conversations
     across Telegram, Discord, Slack, WhatsApp, Signal, Matrix, and other connected platforms."}}
```

**`tools/list` returns 10 tools, and they are a messaging bridge — not the agent's toolset:**

`conversations_list`, `conversation_get`, `messages_read`, `attachments_fetch`, `events_poll`
(cursor), `events_wait` (long-poll), `messages_send`, `channels_list`, **`permissions_list_open`**,
**`permissions_respond`**.

**The last two are the architectural finding.** Another agent, over MCP, can list Hermes' pending
approval requests and answer them. **The human in the loop can be a different agent** — which is
what the approval gate's "gateway round-trip" path was built for.

**For TheoClaw:** `@theokit/agents` has MCP. The parity question is not "do we have MCP" — it is
*what do we expose when we are the server*, and Hermes' answer (conversations plus approvals, not
tools) is a product decision we have not taken.

## 5. `delegate_task` — proven in the transcript, not by the model's word

The model claiming it delegated is not evidence. The exported transcript is:

```
[assistant] tool_calls: [{ id: "toolu_bdrk_019SxW1rPPcc…", … }]
[tool] {"results":[{"task_index":0,"status":"completed","summary":"The answer is **391**…",
        "api_calls":1,"duration_seconds":5.54,"model":…}]}
```

A real tool call, and a **structured** result: `task_index` (so one call carries several tasks),
`status`, `summary`, and the subagent's own `api_calls`, `duration_seconds` and `model`.

**A correction to an earlier reading of my own:** I first noted that delegation cost was missing
from the `auxiliary` block. It is not missing — **the subagent reports its own cost inside the tool
result**, which is a different place from where I looked, not an absence. The empty result was
about the query.

**Method note, because it cost two probes:** `hermes sessions export <id>` treats the argument as
an **output filename**, not a session selector — it wrote all 7 sessions to a file named after the
id and printed one confirmation line. My first grep searched that one line and returned zero. The
zero was about the probe.

**For TheoClaw:** `@theokit/agents` has delegation and A2A/ACP. Unmeasured against this; what is
now known is the *shape* Hermes returns, and that its subagents are in-process tool calls rather
than separate sessions.

## Cost, measured across the five areas

| Turn | api_calls | tokens | cost (incl. auxiliary) |
|---|---|---|---|
| trivial reply | 1 (+1 aux) | 15,302 | $0.0581 |
| delegation | 2 (+1 aux) | 30,516 | $0.0647 |

The system prompt is **14,791 cache-write tokens** on a cold turn, and `prompt-size` attributes
**42,508 B of 48,348 B to tool schemas across 25 tools**. For an agent, the toolset *is* the prompt
budget — which is why `mcp configure`'s per-server tool toggling exists.

## The three gaps this note originally declared — now closed

### `--continuity` — verified, and the injected preamble is the real artefact

A counter job, run twice: **`COUNT=1`** then **`COUNT=2`**. The second run saw the first's output.

But the finding is the preamble Hermes injects into every cron run, read out of the session store.
**Four controls, and each one is a bug somebody already paid for:**

1. **DELIVERY** — *"Your final response will be automatically delivered — do NOT use send_message
   or try to deliver the output yourself."* The agent must not double-deliver.
2. **`[SILENT]`** — a literal token that suppresses delivery when there is nothing new. And the
   hard-won part: *"[SILENT] is a literal ASCII control token — **never translate or rephrase it,
   whatever language the rest of your answer uses**. Never combine [SILENT] with content."* They hit
   a multilingual model translating its own control token. **For a scheduled assistant this is not
   a nicety — an hourly job that says "nothing to report" every hour is spam.**
3. **`[CRON_FAILURE]`** — first line, alone, when a delegated child fails and the run must be
   recorded as failed. Failure is expressible by the agent, not only detectable from outside.
4. **RECURSION guard** — *"NEVER create or update a cron job because of recurring or future-schedule
   language in the task prompt below; treat phrasing like 'each Monday' as context for this run,
   not as a request to schedule another job."* A task prompt containing "every day at 9" would
   otherwise make a scheduled agent schedule more of itself.

Plus the continuity block itself: *"avoid repeating what was already reported, and continue where
the last run left off."*

### MCP client direction — verified, after a pathological first attempt

Pointing Hermes at **its own** `mcp serve` registered fine (discovery listed all 10 tools) and then
**timed out at 35.3 s** on every runtime call. Self-bridging recurses; that is a case I chose, not
a defect they shipped.

Verified properly against a minimal external stdio MCP server written for the purpose:

```
hermes mcp add probe --command python3 --args probe-mcp.py
  → discovery listed the tool, asked which to enable, saved 1/1 to config.yaml
hermes -z "Call the parity_token tool and report exactly what it returned."
  → Returned: MCP-CLIENT-PROBE-OK
```

**Discovery-first install is the pattern:** connect, list the server's tools, ask which to enable,
persist the selection. The per-server toggle is not cosmetic — tool schemas are 42.5 KB of a 48.3 KB
system prompt, so enabling a whole server is a prompt-budget decision.

### Gateway — it RUNS; only send/receive is unverified

`hermes gateway run` started, initialised **six separate databases** — `state.db`,
`shared-state.db (hosted_rooms)`, `shared-state.db (room policy checkpoint)`,
`state.db (delivery_ledger)`, `cron/executions.db`, `kanban.db` — and shut down cleanly on SIGTERM.
**The `delivery_ledger` read about earlier is a real, separately-initialised store.**

**Four findings from the boot log, each worth more than the feature it came from:**

**1. It refuses WAL because the SQLite it found is buggy.**

> *"linked SQLite 3.37.2 … is vulnerable to the WAL-reset corruption bug — **using
> journal_mode=DELETE instead of enabling WAL**. Upgrade to SQLite 3.51.3+ (or backports 3.50.7 /
> 3.44.6); Hermes-managed installs can repair the embedded runtime with `hermes update`."*

It inspects its own runtime, finds a known corruption bug, **gives up the faster journal mode**,
names the fixed versions and the repair command, and says so once per process per database. A
product choosing correctness over speed against a dependency it did not choose.

**2. Authorization defaults to DENY — and this answers PIECE-9 directly.**

> *"Messaging platforms default to pairing/allowlist policies and **will deny unknown senders**
> unless you configure platform allowlists (e.g. `TELEGRAM_ALLOWED_USERS=your_id`) or explicitly
> opt in with `GATEWAY_ALLOW_ALL_USERS=true` **plus** `dm_policy/group_policy: open`."*

Opening the door takes **two** independent opt-ins. PIECE-9 asked whether authorization survives
the self-hosted decision; the product we are matching answers by defaulting closed and requiring
two deliberate acts to open.

**3. It warns that the auxiliary lane costs real money.**

> *"PAID lane engaged for auxiliary task — OpenRouter fallback model 'anthropic/claude-sonnet-4.5'
> is not a :free SKU and may incur real spend. Set `auxiliary.free_only: true` … or
> `auxiliary.openrouter_model` to a :free model."*

The background review and title generation run on **every turn**. They warn that the invisible lane
has a bill, and offer to pin it to free models. That is the cost decision behind OBJ-4's fork.

**4. Shutdown records who killed it.**

> `Shutdown context: signal=SIGTERM under_systemd=no parent_pid=3038791 parent_name=timeout loadavg_1m=3.98`

Signal, whether it was under a service manager, the parent process **by name**, and the load
average. A mysterious restart is traceable instead of a mystery.

## What is still NOT verified

- ~~**No message was ever sent or received.**~~ **CLOSED 2026-09-17** — a real Telegram bot was
  connected and a message went Telegram → gateway → agent → Telegram, with the delivery ledger
  recording the obligation as `delivered`. See `hermes-gateway-e2e-verified.md`.
- **The bot-loop guard and cron delivery are still unexercised** — one conversation, one human, no
  second instance and no scheduled delivery to a platform.
- **`kanban`, `peer`, `egress`, `hooks` and `webhook` were listed, never run.**
- **Tier 2 and Tier 3 remain untouched** — see `hermes-coverage-index.md`.
