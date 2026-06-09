# Public Copy

Source of Truth for voice/tone in README, marketing, and external-facing docs. Enforced by `hooks/public-copy-lint.sh` (advisory, warn-first).

## § 1 — Scope

Applies to:
- `README.md` (any directory)
- `PITCH.md`
- `docs/marketing/**/*.md`
- `docs/guides/**/*.md`

Does NOT apply to:
- `docs/exploration-reports/`, `docs/benchmarks/`, `docs/adr/` — technical-direct
- `CLAUDE.md`, `PRD.md`, `CHANGELOG.md`, source code
- `knowledge-base/references/**` — third-party study material

## § 2 — Anchor

The HERO section (first screen of README) is **outcome-shaped**, not implementation-shaped. Say what the user gets, not what's inside.

- Good: "Provision X in 60 seconds with a single YAML."
- Bad: "Built on <library A> with <library B> and <library C> for GitOps."

Internals belong in a DEEP DIVE section further down (`## How it works`, `## Architecture`, `## Stack`, `## Internals`).

## § 3 — Honesty

Until v1.0 with sustained measured evidence in real production:

- ❌ `production-ready`, `production-grade`
- ❌ `battle-tested`
- ❌ `enterprise-ready`, `enterprise-grade`
- ✅ `designed for production HA scenarios`
- ✅ `targeted at <use case>`

## § 4 — Comparative claims

Performance comparisons require:
1. A reproducible benchmark artifact under `docs/benchmarks/`.
2. Independent reproduction by a third party.
3. The benchmark linked in the same paragraph as the claim.

Without all three, do not state "faster than <X>".

## § 5 — Specific numbers

SLA/uptime numbers (99.9%, 99.95%, 99.99%) require sustained measurement in real production. Until then:

- ✅ `target SLO of 99.9%`
- ✅ `designed to support 99.9% uptime`
- ❌ `99.9% uptime` (unqualified)

Performance numbers (failover < 5s, restore < 1min) need a benchmark link in the same paragraph.

## § 6 — Banned framings

| Banned | Reason | Use instead |
|---|---|---|
| `<competitor> killer` | vendor-hostile | outcome-shaped positioning |
| `drop-in replacement` | implies zero migration cost | specific compatibility surface |
| `lock-in free` / `lock-in proof` | absolute, exaggerated | specific exit affordance ("export with X") |
| `zero downtime` unqualified | hides scope | "minor upgrades are zero-downtime; major upgrades have measured downtime" |

## § 7 — Adapting per project

When a project adopts this template, add a project-specific section listing:
- Internal component names that should NOT appear in the HERO section.
- Competitor names that trigger comparative-claim review.
- Specific SLO targets you commit to (with measurement plan).
