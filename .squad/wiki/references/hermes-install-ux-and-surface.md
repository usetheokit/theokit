# Hermes Agent — installed, and what installing it teaches

**Source:** `github.com/NousResearch/hermes-agent`, **MIT, Copyright (c) 2025 Nous Research**.
Pristine read copy at `knowledge-base/references/hermes-agent` (never versioned). **Installed
separately**, outside the study zone, so the zone stays unwritten — the installer creates `venv/`
and `.env/` in the tree it runs from.

**Installed and exercised 2026-09-17.** Version reported by the binary: **v0.21.3 (2026.9.14),
upstream `cdceca42`**. Everything below is from running it, not from reading it.

## The install, step by step, and what each step costs

```
./setup-hermes.sh
```

One command, and it does six things: detect desktop/server vs Termux, create a Python 3.11 venv,
install the dependency set, create `.env` from a template, symlink `hermes` into `~/.local/bin`,
and offer the setup wizard.

**What it touched on this machine**, measured rather than assumed:

| | |
|---|---|
| `venv/` in the repo tree | Python **3.11.15**, chosen by `uv python find` |
| `.env` | copied from `.env.example`, **`chmod 600`** |
| `~/.local/bin/hermes` | symlink to `venv/bin/hermes` |
| shell rc files | **untouched** — it prints the `source` line rather than editing `.zshrc` |

**It handled a Python this machine could not satisfy directly.** System `python3` is 3.10.12, below
the declared `requires-python = ">=3.11,<3.14"`. The installer never complained: `uv` found a 3.11
and used it. A user with an old default Python never learns there was a problem.

### The non-interactive path is the best thing about the install

Run without a TTY, it does not fail and does not silently half-finish. It prints:

```
☤ Hermes Setup — Non-interactive mode
  Running in a non-interactive environment (no TTY detected).
  The interactive wizard cannot be used here.
  Configure Hermes using environment variables or config commands:
    hermes config set model.provider custom
    hermes config set model.base_url http://localhost:8080/v1
    hermes config set model.default your-model-name
```

**It names the situation, says what cannot happen, and gives the three commands that replace it.**
That is the shape an error message should have, and it is worth copying as a standard rather than
as a feature.

**A correction I owe them.** My first run appeared to exit 0 having created no `.env` and no
symlink, and I nearly recorded that as a defect of the same fail-open class this front has been
hunting all day. It was **my** measurement error: I piped the installer into `tail`, so `$?` was
`tail`'s exit code, not the script's. Re-run without the pipe, it completed correctly. The lesson
is the one already in this front's record — a green exit code from the wrong object.

### One honest caveat the installer states about itself

```
✓ Dependencies installed (transitives re-resolved, not hash-verified)
```

Their `pyproject.toml` pins direct dependencies exactly, with a dated incident behind the policy
(the Mini Shai-Hulud worm, `mistralai 2.4.6`, 2026-05-12). **The installer tells you that the
guarantee stops at the direct layer.** Transitives were re-resolved at install time and no hash was
checked. It is a real gap, and they print it rather than let you assume otherwise — which is more
than most installers do, and directly relevant to REQ-8.

## The surface: 68 top-level commands

Not "a CLI with some subcommands". Grouped by what they are for:

| Area | Commands |
|---|---|
| **Conversation** | `chat`, `console`, `sessions`, `checkpoints`, `journey` |
| **Model & provider** | `model`, `moa` (mixture-of-agents slots), `fallback`, `proxy`, `portal`, `auth`, `logout` |
| **Messaging surfaces** | `gateway`, `whatsapp`, `whatsapp-cloud`, `slack`, `send`, `peer` (bot-to-bot DMs across machines), `pairing`, `webhook` |
| **Skills & learning** | `skills`, `bundles`, `sync` (across devices and with your team), `curator` (background skill maintenance), `memory` |
| **Autonomy** | `cron`, `kanban` (multi-profile collaboration board), `hooks`, `pause` / `resume` (**emergency stop**) |
| **Isolation** | `profile` (multiple isolated instances), `project` (named multi-folder workspaces), `worktree` |
| **Security** | `security` (OSV.dev supply-chain audit of venv, plugins AND MCP servers), `secrets` (Bitwarden, 1Password), `vault`, `egress` (credential-injection firewall), `approvals` |
| **Surfaces** | `dashboard` (web UI), `serve` (headless backend), `desktop`, `acp`, `mcp`, `lsp`, `tui` / `cli` flags |
| **Operations** | `doctor`, `status`, `verify`, `monitoring`, `logs`, `insights`, `dump`, `debug`, `backup` / `import`, `update`, `uninstall` |
| **Migration** | `claw` (OpenClaw), `import-agent` (**Claude Code or Codex CLI setups**), `migrate` |
| **Cosmetic** | `skin`, `pets` |

### The five that are strategy, not features

1. **`pause` / `resume` — "Emergency stop: pause cron/kanban dispatch and new gateway turns".** An
   autonomous agent needs a stop that is not "kill the process". Nothing in our design has one.
2. **`security` audits venv, plugins AND MCP servers** against OSV.dev. The threat surface of an
   agent includes what it was extended with.
3. **`egress` — a credential-injection firewall.** Credentials are injected at the proxy rather
   than handed to the agent. The agent can use a key it never sees.
4. **`peer` — bot-to-bot DMs across machines.** They built this deliberately, and also built
   `bot_loop_guard` because two instances talking is otherwise unbounded. Both halves, not one.
5. **`import-agent` imports Claude Code and Codex CLI setups.** Their adoption path is other agents'
   users, not new users.

### The two flags worth stealing outright

- **`-z/--oneshot`** — *"print ONLY the final response text to stdout. No banner, no spinner, no
  tool previews, no session_id line. Tools, memory, rules and AGENTS.md load as normal; approvals
  are auto-bypassed."* A scriptable mode defined by what it removes.
- **`--usage-file PATH`** — a JSON cost report after a one-shot, *"written even when the run fails,
  so pipelines can always account for spend."* Spend accounting that survives failure is a decision
  most products get wrong.

## CONFIGURED AND EXERCISED — the loop closes

Configured with Paulo's OpenRouter key: `model.provider = openrouter`,
`model.default = anthropic/claude-sonnet-4.5`. **The agent answers.** First turn: correct response
in **11.4 s**.

### The closed learning loop, verified by running it rather than by reading about it

This is the measurement OBJ-4's decision now rests on, and it was done in **two separate
processes**:

1. **Turn 1**, a fresh `-z` one-shot: told it a fact about the user. The process exited.
2. `~/.hermes/memories/USER.md` appeared — **101 bytes, written autonomously**, with no tool call
   the user asked for.
3. **Turn 2**, a different `-z` process: *"What language do I write commit messages in?"* →
   *"You write commit messages in English only."*

**And what it stored is the interesting part.** It did not log the sentence it was given. It
rewrote it into third-person declarative statements about the user:

> *"Writes commit messages in English only, never Portuguese. Refuses Co-Authored-By trailers in
> commits."*

**That is curation, not persistence.** The background review read a conversational turn and emitted
a user-model entry — which is exactly what `agent/background_review.py` claims to do, now observed
rather than believed.

**A correction to the documented paths:** the docs describe `MEMORY.md` and `USER.md`; on disk they
are under `~/.hermes/memories/`, alongside a `USER.md.lock`. `~/.hermes/MEMORY.md` does not exist.

### `--usage-file` is the best DX artifact in the product

The JSON after one turn:

| field | value | why it matters |
|---|---|---|
| `cost_status` / `cost_source` | `estimated` / `provider_models_api` | it says **how** it knows the cost, not just the number |
| `input_tokens` | 10 | |
| `cache_write_tokens` | **14,791** | the system prompt, paid once |
| `reasoning_tokens` | 62 | counted apart from output |
| `turn_exit_reason` | `text_response(finish_reason=stop)` | **why** the turn ended |
| `completed` / `partial` / `interrupted` / `failed` | four separate booleans | not one collapsed status |
| `auxiliary.by_task` | `title_generation: $0.001467` | |
| `total_including_auxiliary` | `$0.0581`, 2 api_calls | |

**The `auxiliary.by_task` block is the standout, and it is a discipline rather than a feature.**
Generating the session title cost a second API call, and they break it out by name. Most products
report the number that flatters them; this one reports the one that does not.

### `prompt-size` makes the cache design visible

```
System prompt total :  48,348 B        Tool schemas : 42,508 B (25 tools)
  skills index :   5,364 B
  memory       :       0 B
  user profile :       0 B
Prompt tiers:
  stable   (identity/guidance/skills)  :   7,787 B
  context  (AGENTS.md/cwd files)       :  33,617 B
  volatile (memory/profile/timestamp)  :   6,940 B
```

Two things fall out of this that no amount of reading would have given:

1. **The three tiers ARE the caching design.** Stable first, volatile last — that ordering is what
   lets a prefix cache hold. A product that interleaves memory into the identity block cannot cache.
2. **Tool schemas (42.5 KB) are nearly the size of the entire system prompt (48.3 KB).** For an
   agent, the toolset IS the prompt budget. Our own `sdk-tools` count has never been measured this
   way.

### A display inconsistency worth one line

`hermes status` prints `.env file: ✗ not found` and, four lines below, `OpenRouter ✓ sk-o...bbd4` —
having read that key from the `.env` it says it could not find. The key masking is right; the
`.env` probe is looking somewhere else. Minor, and exactly the class of "two probes disagreeing
about one fact" this front has been finding all day.

## What was installed but is still NOT configured

`hermes` runs and reports `no model configured — run /model or hermes setup`. **No API key was
supplied and none was taken from this machine.** Configuring the agent to actually answer requires
a provider credential, and that is Paulo's to give — the install is complete, the loop is not
closed.

## Debris this created, and it needs a decision

`~/.local/bin/hermes` is a symlink into a **session-scoped scratchpad under `/tmp`**. When that is
cleaned, the symlink dangles and `hermes` on PATH breaks. The venv cannot simply be moved — it
holds absolute paths.

**Two ways out:** reinstall into a permanent directory and repoint the symlink, or remove the
symlink and invoke through `venv/bin/hermes`. This is written down rather than left for someone to
discover as a broken command.

## What this note does NOT establish

- **Nothing about behaviour with a model attached.** Every observation is of the CLI's own surface.
  The agent has not answered a single turn.
- **No gateway was connected.** Messaging, cron, kanban and peer are unexercised.
- **68 commands were listed; roughly ten were run.** `--help` output is a claim by the product about
  itself, and only the install path was independently verified.
