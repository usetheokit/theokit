---
name: dogfood
version: 0.1.0
requires: []
description: Honesty gate that blocks any 'production-ready' / 'production-grade' / v1.0 claim without recorded evidence of sustained internal use. Reads the project's dogfood manifest at knowledge-base/dogfood/manifest.md plus evidence files at knowledge-base/dogfood/evidence/, applies the project-specific dogfood golden rule (rules/dogfood-golden-rule.md — created per project), and emits EVIDENCE_SUFFICIENT / EVIDENCE_WITH_CAVEATS / EVIDENCE_INSUFFICIENT. Invoke before any production claim, milestone promotion targeting v1.0, README/CHANGELOG edit that touches status language, or release decision.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit
argument-hint: "[audit|log-evidence|status]"
---

# Skill: dogfood

Applies the project's **dogfood golden rule** (`rules/dogfood-golden-rule.md`) to the manifest at `knowledge-base/dogfood/manifest.md` and evidence files in `knowledge-base/dogfood/evidence/`. Emits a verdict on whether the project may legitimately claim `production-ready` / `production-grade` / `v1.0 ready`.

**This skill is NOT optional for a v1.0 claim.** Read `rules/dogfood-golden-rule.md` before invoking.

## Pre-conditions (per-project)

This skill assumes the project has defined:

1. **A dogfood golden rule** at `rules/dogfood-golden-rule.md` — declares the project's anchor scenario, the meaning of each `Status` value (e.g., `planned | wired | running | paused | abandoned`), evidence freshness thresholds, and the conditions under which the anchor may change.
2. **A manifest** at `knowledge-base/dogfood/manifest.md` — declares the project's anchor scenario slug, current `Status`, and target dates.
3. **An evidence directory** at `knowledge-base/dogfood/evidence/` — append-only log of dogfood runs. Each file carries frontmatter with `scenario:`, `date:`, and a structured summary of what was exercised.

If any of these is missing, the skill emits `EVIDENCE_INSUFFICIENT` with the corresponding flag (`golden_rule_missing`, `manifest_missing`, or `evidence_dir_missing`).

## Why this skill exists

Chaos tests and synthetic benchmarks prove the system responds to a workload. **Dogfood proves the system is usable when the team that built it depends on it.** Without a dogfood gate, the temptation to claim `production-ready` at v1.0 — backed only by CI passing on toy clusters — is high. The classic platform failure mode is shipping something that passes CI but breaks the moment internal teams try to use it for anything beyond hello-world.

The skill is the gate that keeps the production claim honest against that temptation.

## Arguments

- `$ARGUMENTS = audit` (or empty) → runs the full gate and emits a verdict.
- `$ARGUMENTS = log-evidence` → interactive mode: helps record new evidence for the anchor or a sibling scenario.
- `$ARGUMENTS = status` → quick summary (Status + evidence count + age of latest); no formal verdict.

## Process — `audit` mode (default)

### Step 1 — Verify pre-conditions

Check that `rules/dogfood-golden-rule.md`, `knowledge-base/dogfood/manifest.md`, and `knowledge-base/dogfood/evidence/` all exist. Missing any → emit the corresponding flag + verdict `EVIDENCE_INSUFFICIENT`. Stop.

### Step 2 — Locate the anchor section in the manifest

The manifest declares an anchor scenario by a slug field (`**Slug**`, `Slug:`, or equivalent — defined by the golden rule). Extract:

- `Status` — must be one of the values declared in the golden rule
- The "target date" field (golden rule names it; e.g., `Anchor MUST become running before`)
- The `Latest evidence` list if present

Missing anchor section OR missing `Status` field → flag `anchor_missing`.

### Step 3 — Apply hard caps to the anchor

In order:

| # | Check | Flag on failure |
|---|---|---|
| 1 | Anchor section present + `Status` present | `anchor_missing` |
| 2 | `Status` matches the golden rule's "running" value (case-insensitive) | `anchor_not_running` |
| 3 | `glob` of `knowledge-base/dogfood/evidence/*.md` returns ≥ 1 file whose frontmatter `scenario:` matches the anchor slug | `no_anchor_evidence` |
| 4 | The most recent matching file (by `date:` frontmatter) is within the freshness threshold declared in the golden rule | `anchor_evidence_stale` |

**Any flag → verdict `EVIDENCE_INSUFFICIENT`.** No exceptions.

### Step 4 — Apply soft caps (only if all hard caps pass)

Soft caps are defined per-project in the golden rule (e.g., minimum evidence count, coverage of sibling scenarios, presence of failure stories). Any soft cap fail → verdict `EVIDENCE_WITH_CAVEATS` and list which caps fired.

### Step 5 — Emit verdict

```
EVIDENCE_SUFFICIENT     — all hard + soft caps pass
EVIDENCE_WITH_CAVEATS   — all hard caps pass, ≥ 1 soft cap failed
EVIDENCE_INSUFFICIENT   — any hard cap failed
```

Verdict goes to stdout in a fenced block; full details (which caps fired, evidence age, etc.) follow.

## Process — `log-evidence` mode

Interactive: asks for scenario slug, date (defaults to today), and a summary template. Writes `knowledge-base/dogfood/evidence/{scenario}-{YYYY-MM-DD-HHMMSS}.md` with the required frontmatter.

## Process — `status` mode

Reads the manifest's anchor `Status` field, counts evidence files matching the anchor slug, reports the age of the most recent one. Emits a one-line summary. Never emits a verdict.

## Output

- `audit` and `log-evidence` modes write to `knowledge-base/reviews/dogfood-{YYYY-MM-DD}.md`.
- `status` mode is stdout-only.

## Anti-patterns

- Treating `EVIDENCE_WITH_CAVEATS` as `SUFFICIENT`. Caveats are explicit — read them.
- Logging evidence for a different scenario and claiming it satisfies the anchor.
- Silently changing the anchor when it becomes inconvenient. The golden rule declares when (and how) the anchor may change.
- Running dogfood as theater. The point is to actually use the thing.
