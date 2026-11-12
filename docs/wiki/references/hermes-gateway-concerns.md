# Hermes Agent — what a gateway needs once it actually runs for a while

**Source:** `github.com/NousResearch/hermes-agent`, **MIT, Copyright (c) 2025 Nous Research**.
Read at `knowledge-base/references/hermes-agent` (never versioned, never copied from). Written from
reading; no line of their code is reproduced here beyond short quotes of prose.

**Read 2026-09-17.** File names and claims are verified against the tree. Where a claim comes from
a docblock rather than from the implementation, it says so.

## The size difference, measured

`gateway/` in Hermes holds **114 `.py` files**. Ours (`theokit-gateways/packages/gateway/src/`) is
a fraction of that across 8 directories. The gap is not adapters — we have ten platforms with eight
proven end-to-end. The gap is everything that only becomes a problem after an assistant has been
running for months.

## Seven concerns with no equivalent here

Verified present; the descriptions come from each file's own docblock.

| File | What it is for |
|---|---|
| `delivery_ledger.py` | durable delivery-obligation ledger for final responses |
| `dead_targets.py` | persistent record of confirmed-unreachable destinations |
| `bot_loop_guard.py` | sliding-window budget for bot-authored inbound |
| `drain_control.py` | external drain-marker contract (dashboard → gateway) |
| `authz_mixin.py` | per-user / per-chat authorization — may this person talk to the agent |
| `agent_cache_pressure.py` | memory-pressure limits on the per-session agent cache |
| `code_skew.py` | detect that the gateway is running stale code after a hot `git pull` |

### The two worth reading in full, because their design is the content

**`delivery_ledger.py` — a four-state machine whose value is the crash semantics, not the states.**
Rows live in the shared `state.db` with WAL, owner pid and process-start liveness, and bounded
retention, *"so a crash between finalize and platform ACK cannot lose a response silently."* The
checkpoints are `record_obligation()` **before any send**, `mark_attempting()` **right before the
await**, `mark_delivered()` **only on `SendResult.success`**, `mark_failed()` on definitive
rejection.

What makes it worth copying the *idea* of is the rule it states — **"never silently resend an
ambiguous send"** — and that each state has a different recovery:

| state | meaning after a crash | what happens |
|---|---|---|
| `pending` | never started | redeliver plainly |
| `attempting` | crashed mid-await, **the platform may already have it** | redeliver **with a visible recovered marker** |
| `failed` | rejected once; a restart is a retry boundary | redeliver, also marked |
| `delivered` | done | prune |

The `attempting` row is the whole design. A naive retry either loses messages or duplicates them
silently; this one duplicates them **visibly**, and tells the user why. That is a product decision
living in a persistence layer.

**`bot_loop_guard.py` — and the reason is sharper than "rate limiting".** Its docblock:

> *"`{PLATFORM}_ALLOW_BOTS` only decides admission, so two Hermes profiles replying to each other
> never stop."*

It counts admitted bot messages per conversation and drops further ones for `cooldown_seconds` once
`max_events` land in `window_seconds`. **This is not abuse protection — it is the product defending
against itself.** For an open-source, self-hosted assistant, where the expected outcome is many
people running many instances in shared channels, two instances meeting is a matter of time.

## What this means for TheoClaw — as questions, not as a build list

These are seven concerns from a product that has been running longer. Naming them is worth more
than adopting them.

1. **`delivery_ledger` and `bot_loop_guard` belong in the TRD conversation.** Not necessarily in the
   first release — but "what happens to a reply when the process dies between the model finishing
   and the platform acknowledging" has an answer today by default, and the default is *lose it
   silently*.
2. **`authz_mixin` is simpler here, not absent.** Paulo decided self-hosted, one instance per
   person. That removes tenancy; it does not remove *"can this Telegram user talk to my agent"*,
   because a bot token is public by construction.
3. **`code_skew` is a symptom of their deployment model**, not obviously ours. Listed for
   completeness and flagged as probably-not-ours.

## What this note does NOT establish

- **No implementation was read.** Everything above is the docblock plus the file's existence. If any
  of these becomes a PIECE, that is a new measurement.
- **Whether any of it is good.** A competitor that has been running longer has also accumulated
  decisions that were right for their multi-tenant, their hosting and their cadence. This note
  refuses to treat "they have it" as "we need it".
- **The other 107 files.** Seven were surfaced; `gateway/` has 114. Nothing here claims the
  remainder is uninteresting — only that it is unread.
