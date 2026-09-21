# 0012 — Mutation testing is declared unmeasured, rather than run inside the plan gate

- **Status:** accepted
- **Date:** 2026-09-21
- **Decides:** B-189's first Definition-of-done bullet, which offers two ways out and asks which.

## Context

`/code-quality` emits `soft_cap_mutation_unconfigured_typescript` on every run of this repository.
Measured 2026-09-21 by running the gate rather than by reading the item: verdict `FAIL_SOFT`, one
soft cap, and it is that one.

`code-quality-golden-rule.md` § 2 maps an unconfigured mutation runner to `FAIL_SOFT` (cap 70), and
`cycle-plan.md` requires a verdict of at least `SHIPPABLE_WITH_CAVEATS` to enter `/implement`. So the
cap is not cosmetic: it is permanent, it caps every plan at 70, and `cycle-code-quality.md` records
what a permanent cap becomes — *"a gate people bypass, which is the failure this kit exists to
prevent"*.

The question this ADR answers is not whether mutation testing is worth doing. It is **where it runs**.

## What the cost actually is

`code-quality-golden-rule.md:165` records `npx stryker run` at **1347s** on a consumer, and states the
consequence in its own words: *"every plan gate in that repository cost 22.5 minutes… a 22-minute
gate is a gate people bypass"*.

This repository is larger — **662 TypeScript files, 91,738 lines** under `packages/*/src`. And
`/plan-confidence` invokes `/code-quality` internally, so the cost is paid per plan, not per release.

Nothing here is configured today: `@stryker-mutator/*` is in no manifest, and no `stryker.config.*`
exists anywhere in the tree.

## Decision

**Declare the measurement absent, in the project's allowlist, with a sunset — rather than configure a
runner inside the gate.**

The entry names `mutation_low` against `.` with a 2026-12-20 sunset, which is the 90-day maximum
`code-quality-golden-rule.md` § 4 permits. It expires; it does not disappear.

## What this does NOT claim

It does not claim the tests are strong. `soft_cap_mutation_unconfigured_typescript` is an **honest
verdict**: it says the measurement did not happen, not that the suite has no holes. Two hand-applied
mutants against one runner were killed on 2026-09-19, which is evidence about two assertions and not
a score.

Anyone reading a green `/code-quality` after this ADR must read it as *"the mutation question was not
asked"*, and the allowlist entry's own reason says so.

## Who is affected

- **Every plan scored in this repository**, which stops being capped at 70 by a measurement nobody
  performed.
- **Nobody downstream.** The allowlist is `.claude/rules/`, which is not versioned and reaches no
  consumer of the published packages. No API, no behaviour and no published artifact changes.
- **And nobody on another checkout of this repository either**, which is the half worth stating
  plainly. `.claude/` is excluded from git by project policy, so the entry that ENACTS this decision
  exists on one machine. Another clone running `/code-quality` still gets `FAIL_SOFT` on the same
  cap, for the same reason, with no record of this decision in reach.
  That is the known cost of the policy rather than an oversight, and it is why this ADR is in
  `docs/adr/` where it travels: the REASONING reaches the next reader even though the one-line
  configuration does not. Whoever meets the cap on another machine adds the same line and can read
  why.

## What would break, and what would not

Additive to the gate's inputs, subtractive to its output: one fewer soft cap. The finding is still
computed and still printed — the allowlist downgrades severity by one level, it does not silence the
detector. A NEW mutation finding of a different kind is unaffected.

## Alternatives rejected

**Configure Stryker and let `/code-quality` invoke it.** Rejected on the measurement above: it
reproduces, amplified, the exact failure `cycle-code-quality.md` names. The item itself refuses this
form.

**Run it out of band on a schedule, and let D4 read the report.** This is the right long-term shape
and the kit already carries the mechanism — `mutation.max_report_age_minutes` makes D4 READ a recent
report instead of re-running the tool, and D4 looks for `reports/mutation/mutation.json`. It is
rejected **now**, not on principle, because it needs five moving parts that do not exist: the
devDependencies, a config scoped to something smaller than 662 files, a scheduled workflow, a report
that is on disk when the gate runs, and an age threshold raised past the 1440-minute default. Each is
a decision with a recurring cost, and taking them inside an item whose DoD offers the cheaper answer
would be widening the item rather than doing it.

**Remove the cap from the golden rule.** Rejected outright: that is moving a threshold so a gate
passes, which `autonomy-envelope.md` floor 3 forbids by name.

## What brings this back

The sunset, at 2026-12-20. When it expires the finding re-fires at full severity, and whoever meets
it then decides again with whatever is true then — which is the point of a sunset rather than a
permanent exemption.
