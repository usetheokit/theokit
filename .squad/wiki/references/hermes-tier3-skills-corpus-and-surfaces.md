# Hermes Tier 3 — what a skill actually is, and the surfaces nobody demos

**Source:** `github.com/NousResearch/hermes-agent`, MIT, Copyright (c) 2025 Nous Research.
**v0.21.3, measured 2026-09-18** against the installed copy and its shipped corpus.

## The skill corpus, counted — 58 skills

| | |
|---|---|
| size | median **9,357 bytes**, range 2,336 – 34,415 |
| categories | productivity 14, software-development 12, creative 10, autonomous-ai-agents 5, research 4, apple 4, media 3, email 2, and five singletons |

**Frontmatter is uniform in a way that is itself the finding.** All 58 carry `name`,
`description`, `version`, **`author`**, **`license`**, **`platforms`**; 56 carry `metadata`; 12
declare `prerequisites`.

**`author` and `license` on every single one** means a skill is a *distributable artifact with
provenance*, not a note. That is what makes the trust tiers in `skills_guard.py` possible —
`builtin` / `trusted` / `community` / `agent-created` are only meaningful if origin travels with
the file.

**`platforms` on every one** means a skill declares where it may run, so the resolver can exclude
a macOS-only skill from the prompt on Linux. That is prompt budget as much as correctness.

### The subdirectory layout, and the number that matters

| directory | skills using it |
|---|---|
| `references/` | 16 |
| `scripts/` | 13 |
| `templates/` | 7 |
| **`tests/`** | **4** |

**Four of fifty-eight ship tests** — `pdf`, `powerpoint`, `docx`, `xlsx`, all four being the
document-manipulation skills whose Python actually breaks. Thirteen ship executable scripts; nine of
those thirteen have no test.

**And nothing runs them.** The only CI reference to `skills/**` is `deploy-site.yml` — publishing
the documentation site. No workflow executes a skill test.

**This settles the synthesis question this front has been circling.** The format *allows* an
executable oracle, 7% of the corpus uses it, and no pipeline enforces it. `theokit-skills`'
doctrine — code copied byte-for-byte from a CI-executed example — has **no counterpart here**, in
the corpus or in the automation. The gap is real, it is not an oversight of one skill, and it is
the one place a TheoClaw could be honestly better rather than merely different.

### The skill lifecycle is a package manager

`hermes skills`: `trust untrust browse search install inspect list check update audit uninstall
reset list-modified diff opt-out opt-in repair-official publish snapshot tap config`.

Four worth naming:

- **`trust` / `untrust`** — repo-local skills (`./.hermes/skills`, `./.agents/skills`) do **not**
  load until the project is trusted. **A cloned repository cannot inject a skill by existing.**
  Same default-closed rule as hooks and plugins.
- **`inspect`** — read a skill before installing it.
- **`list-modified` / `diff` / `repair-official`** — detect local drift from the published version
  and restore it. Skills are expected to be edited in place and to need repair.
- **`tap`** — third-party registries, Homebrew-style.

## `lsp` — not an editor feature, an oracle for the agent's own writes

> *"Manage the LSP layer that powers **post-write semantic diagnostics in `write_file`/`patch`**."*

```
enabled: True    wait_mode: document    wait_timeout: 5.0s
install_strategy: auto    active clients: none
```

**On by default, auto-installing language servers on demand.** After the agent writes a file, a
language server tells it whether what it wrote is semantically broken — within a 5-second budget.

**That is the closest thing in the product to an execution oracle**, and it is aimed at the agent's
*code edits* rather than at its skills. A design here should notice the asymmetry: Hermes verifies
what the agent writes into a repository and does not verify what it writes into a skill.

## The other surfaces, briefly

| command | what it is |
|---|---|
| `serve` | JSON-RPC/WebSocket backend for the desktop app and remote clients. Headless. Carries `--ssh-session-token-file` and `--ssh-owner-nonce` — remote access is token-plus-nonce, not a password |
| `dashboard` | web UI for config, **API keys** and sessions |
| `acp` | Agent Client Protocol for VS Code, Zed, JetBrains |
| `insights` | token usage, cost, tool patterns and activity from session history |

## `insights` on this machine — and the number that should worry a per-turn fork

Real output after one day of testing:

```
Sessions 14 · Messages 88 · Tool calls 28
Input tokens 4,055 · Output tokens 5,619 · TOTAL 843,299
Estimated cost ~$0.96
```

**Input plus output is 9,674 tokens. The total is 843,299.** The other **98.8%** is prompt cache —
the ~48 KB system prompt paid across 14 short sessions.

**This is the cost shape of an agent, and it is not the shape people assume.** The conversation is
noise; the prompt is the bill. Two consequences for TheoClaw:

1. **OBJ-4's per-turn background-review fork multiplies the dominant cost, not the small one.**
   Hermes mitigates it by having the fork inherit the live runtime so it hits the same prefix cache
   — that detail is not an optimisation, it is what makes the design affordable at all.
2. **`mcp configure`'s per-server tool toggling and `platforms` in skill frontmatter are the same
   lever.** Both trim the prompt, which is where 98.8% of the spend is.

## What is NOT established

- **No skill was installed, published or audited** — the lifecycle verbs are read, not run.
- **`lsp` has no active clients**, so post-write diagnostics were never observed firing.
- **`serve`, `dashboard` and `acp` were not started.** Their auth models are read from `--help`.
- **The `insights` figures are this machine's test traffic**, not representative usage.
