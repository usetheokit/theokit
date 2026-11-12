# Hermes analysis — what is covered, what is not, and what each gap would decide

**Purpose:** this front will implement against Hermes. An analysis that does not say what it did
NOT look at is a map with no edges — the reader assumes the blank parts are empty rather than
unvisited.

**Measured 2026-09-17**, after install and three real turns.

## Coverage, counted

| Surface | Covered | Total | How |
|---|---|---|---|
| CLI commands | **9** | 68 | run |
| `gateway/*.py` | 7 | 114 | docblock only |
| `tools/*.py` | 3 | 259 | read |
| `hermes_state_*.py` | **0** | 26 | — |
| bundled skills | **0** | 58 | — |
| toolsets | listed | 17 | `--list_toolsets` |

**Roughly 13% of the command surface, and the deep subsystems are unvisited.**

## What IS established, and to what standard

| Area | Standard | Note |
|---|---|---|
| Memory + the closed learning loop | **verified by running it**, across two processes | `hermes-install-ux-and-surface.md` |
| Skill creation, validation, threat guard | code read end to end | `hermes-skills-and-guard.md` |
| Terminal approval gate + ordering | code read (`check_all_command_guards` body) | same |
| Install, UX, cost reporting, prompt tiers | measured | `hermes-install-ux-and-surface.md` |
| Display resolver (`display_config.py`) | config + comments read; **consumers not read** | `technical-pieces.md` PIECE-1 |
| 7 gateway concerns | **docblock only** | `hermes-gateway-concerns.md` |
| Supply-chain pinning | `pyproject.toml` read, incident dated | `trd.md` REQ-8 |

## The gaps, ranked by what each one would decide for TheoClaw

### Tier 1 — **CLOSED 2026-09-17**, all five exercised against the running binary

See `hermes-tier1-verified.md`. Each was verified by running it, and two produced findings that
reading had missed: the MCP server exposes a **messaging bridge with approval delegation**, not the
agent's tools; and `profile delete` left a **declared, retryable** identity settlement pending
rather than failing silently — a mechanism read about earlier and then observed firing.

What the five did **not** cover is listed at the end of that note: no gateway connected,
`--continuity` unexercised, MCP client direction unexercised.

### Tier 1 — the original entries, kept for what each was waiting on

1. **`cron` + autonomy.** Paulo declined "nothing happens unless you start it" as a problem, but set
   a Hermes-or-better bar, and Hermes has `cron`, `kanban` dispatch and `pause`/`resume`. **No PIECE
   covers scheduled work.** Decides whether TheoClaw acts unprompted at all.
2. **`profile` — multiple isolated instances.** One instance per person was decided; profiles are a
   different axis (one person, several isolated agents). Decides whether `~/.theoclaw` is one root
   or many.
3. **The 26 `hermes_state_*` modules.** `compression`, `rewind` (`/undo`, `/retry`), `wal`,
   `readpool`, `lockguard`, `repair`, `portability`. **This is session durability, and no PIECE
   mentions it.** OBJ-4 covers what the agent remembers about the user; nothing covers what a
   session preserves about itself.
4. **`mcp`** — both directions: Hermes as MCP client and as MCP server. `@theokit/agents` has MCP;
   the parity question is which direction and whether it is at parity.
5. **`delegate_task` / sub-agents.** `@theokit/agents` has delegation and A2A/ACP. Unmeasured
   against theirs.

### Tier 2 — **CLOSED 2026-09-18** · see `hermes-tier2-security-surface.md`

`egress`, `security`, `approvals`, `hooks`, `plugins` all exercised. The sweep produced the single
most consequential finding of the whole analysis — the terminal approval gate classifies
DESTRUCTION and not DISCLOSURE, five credential-exfiltration shapes return `allow`, and the
mitigation (`iron-proxy`) ships uninstalled.

### Tier 3 — **CLOSED 2026-09-18** · see `hermes-tier3-skills-corpus-and-surfaces.md`

The 58-skill corpus, the skill lifecycle, `lsp`, `serve`, `dashboard`, `acp`, `insights`. Settled
the synthesis question (4 of 58 skills ship tests; nothing runs them) and measured the real cost
shape: **98.8% of tokens are prompt cache, not conversation.**

### Tier 2 — the original entries, kept for what each was waiting on

6. **`egress`** — credential-injection firewall; the agent uses a key it never sees. No equivalent
   here, and it is a security posture rather than a feature.
7. **`security`** — OSV.dev audit of venv, plugins AND MCP servers.
8. **`approvals`** — mining approval history into allowlist proposals; the learning half of the gate.
9. **`hooks`** — shell-script hooks, i.e. the user's own extension point.
10. **`plugins`** + `plugin-catalog/` — a distribution surface we have as `@theokit/plugin-*`.
11. **`browser` / `computer-use`** — 20+ browser tools and a cua-driver backend.
12. **`tts` / voice** — `@theokit/plugin-voice` exists; parity unmeasured.

### Tier 3 — read for completeness, unlikely to change a decision

13. `skin`, `pets`, `insights`, `dashboard`, `desktop`, `serve`, `lsp`, `acp`.
14. The 58 bundled skills — useful as a corpus of what skills look like in practice.
15. The 107 unread `gateway/` files beyond the seven surfaced.

## What would close this honestly

Two passes, in this order, because the second is cheap only after the first:

1. **Exercise Tier 1 with the installed binary.** `cron`, `profile`, `mcp`, `sessions`, `delegate`.
   Running beats reading — every claim in these notes that survived scrutiny today came from a run,
   and three that came from reading were wrong.
2. **Read the subsystems Tier 1 exposed**, and only those. Reading 259 tool files produces a list;
   reading the five a decision depends on produces a decision.

**What this index is FOR:** so nobody implements against "what Hermes does" while holding 13% of it,
and so the 87% is a named queue rather than an assumption.
