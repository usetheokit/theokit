# ROADMAP — framework surface parity

Sixteen milestones, one per framework surface. Each surface is a `*-specialist` skill under
`.claude/skills/`; the milestone closes when the published packages meet that surface's
specification and `/acceptance` says so against the released artifact.

## What "done" means here

**The target is the specification, not a competitor's release.** Parity is measured against
WHATWG / W3C / RFC where a specification exists, and against the surface's own documented
contract where one does not. "Next.js does it this way" is prior art; it is never the criterion.
That is the same rule gate G5 enforces at intake (`.claude/rules/cycle-backlog.md § Hard gates`).

**The artifact is the released build, never the working tree.** These are internal packages, so
`/acceptance` builds from the released tag in a clean checkout and consumes the result the way a
real consumer does — see `.claude/rules/cycle-acceptance.md § Target kinds`. `pnpm dev` against a
dirty tree is not an acceptance run.

**The checkbox is flipped by `/acceptance`, never by hand.** `[x]` claims *"we shipped it and
watched it work"*. Only `ACCEPTED` or `ACCEPTED_WITH_CAVEATS` may flip it, and only one flips per
release (`.claude/rules/cycle-acceptance.md § Hard gates`).

## Reading the Definition of done

Every milestone carries the same three structural criteria — the gap is re-measured, every gap row
is either closed or explicitly declined in an ADR, and acceptance ran against the published
artifact. They are written out in each block because `extract_acceptance_criteria.py` reads each
block independently; the repetition is the tool's contract, not redundancy.

The fourth bullet is the surface's own behavioural criteria, and it is deliberately
**`(to fill — awaiting measurement)`**. Those criteria come from the `theokit-gap.md` re-measurement
now running; writing them ahead of the measurement would be exactly the plausibility-invented
criterion the acceptance cycle refuses to grade against.

## Dependencies

Only dependencies on the three core milestones are declared, and each is a mechanism rather than a
sequencing preference — a surface depends on M1 when it crosses the server boundary, on M2 when it
consumes or alters rendered output, on M3 when it depends on what the build emits. Wave order is
not itself a dependency: two milestones in the same wave may run in either order.

The graph below is a judgement call and is reviewable. It is not derived from measurement, and it
does not encode anything the gap files will say.

## Wave 1 — the core

### M1 — [ ] server-boundary-security

**Surface:** `.claude/skills/server-boundary-security-specialist/` — what may cross from server to client, and what must never be reachable from a browser.
**Dependencies:** none — core surface
**Definition of done (all must hold):**

- [ ] `.claude/skills/server-boundary-security-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M1` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `server-boundary-security` *(to fill — awaiting measurement)*

### M2 — [ ] rendering-pipeline

**Surface:** `.claude/skills/rendering-pipeline-specialist/` — where markup is produced, when it streams, and what the client re-executes.
**Dependencies:** none — core surface
**Definition of done (all must hold):**

- [ ] `.claude/skills/rendering-pipeline-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M2` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `rendering-pipeline` *(to fill — awaiting measurement)*

### M3 — [ ] bundler-architecture

**Surface:** `.claude/skills/bundler-architecture-specialist/` — how modules are graphed, split, transformed and emitted.
**Dependencies:** none — core surface
**Definition of done (all must hold):**

- [ ] `.claude/skills/bundler-architecture-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M3` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `bundler-architecture` *(to fill — awaiting measurement)*

## Wave 2

### M4 — [ ] route-conventions

**Surface:** `.claude/skills/route-conventions-specialist/` — how a file path becomes a URL, and what a route file is allowed to export.
**Dependencies:** M2, M3
**Definition of done (all must hold):**

- [ ] `.claude/skills/route-conventions-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M4` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `route-conventions` *(to fill — awaiting measurement)*

### M5 — [ ] caching-revalidation

**Surface:** `.claude/skills/caching-revalidation-specialist/` — what is cached, under which key, for how long, and who may invalidate it.
**Dependencies:** M2
**Definition of done (all must hold):**

- [ ] `.claude/skills/caching-revalidation-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M5` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `caching-revalidation` *(to fill — awaiting measurement)*

### M6 — [ ] navigation-prefetching

**Surface:** `.claude/skills/navigation-prefetching-specialist/` — what a client transition fetches, keeps, and shows in between.
**Dependencies:** M2, M3
**Definition of done (all must hold):**

- [ ] `.claude/skills/navigation-prefetching-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M6` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `navigation-prefetching` *(to fill — awaiting measurement)*

### M7 — [ ] dev-experience

**Surface:** `.claude/skills/dev-experience-specialist/` — how fast a change is visible, what state survives it, and what an error says.
**Dependencies:** M3
**Definition of done (all must hold):**

- [ ] `.claude/skills/dev-experience-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M7` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `dev-experience` *(to fill — awaiting measurement)*

### M8 — [ ] observability

**Surface:** `.claude/skills/observability-specialist/` — what a running application emits, and how a request is followed across a boundary.
**Dependencies:** M1
**Definition of done (all must hold):**

- [ ] `.claude/skills/observability-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M8` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `observability` *(to fill — awaiting measurement)*

## Wave 3

### M9 — [ ] metadata

**Surface:** `.claude/skills/metadata-specialist/` — titles, canonicals, social cards, robots directives and structured data.
**Dependencies:** M2
**Definition of done (all must hold):**

- [ ] `.claude/skills/metadata-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M9` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `metadata` *(to fill — awaiting measurement)*

### M10 — [ ] asset-optimization

**Surface:** `.claude/skills/asset-optimization-specialist/` — how images, fonts and static files are processed, addressed and cached.
**Dependencies:** M3
**Definition of done (all must hold):**

- [ ] `.claude/skills/asset-optimization-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M10` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `asset-optimization` *(to fill — awaiting measurement)*

### M11 — [ ] content-pipeline

**Surface:** `.claude/skills/content-pipeline-specialist/` — how authored content becomes a route and a rendered document.
**Dependencies:** M2, M3
**Definition of done (all must hold):**

- [ ] `.claude/skills/content-pipeline-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M11` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `content-pipeline` *(to fill — awaiting measurement)*

### M12 — [ ] i18n

**Surface:** `.claude/skills/i18n-specialist/` — how a locale is negotiated, routed, and carried through rendering.
**Dependencies:** M2
**Definition of done (all must hold):**

- [ ] `.claude/skills/i18n-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M12` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `i18n` *(to fill — awaiting measurement)*

### M13 — [ ] middleware-edge

**Surface:** `.claude/skills/middleware-edge-specialist/` — what runs before a route resolves, and under which runtime constraints.
**Dependencies:** M1
**Definition of done (all must hold):**

- [ ] `.claude/skills/middleware-edge-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M13` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `middleware-edge` *(to fill — awaiting measurement)*

## Wave 4

### M14 — [ ] build-adapters

**Surface:** `.claude/skills/build-adapters-specialist/` — what the build emits, and what a deploy target consumes.
**Dependencies:** M3
**Definition of done (all must hold):**

- [ ] `.claude/skills/build-adapters-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M14` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `build-adapters` *(to fill — awaiting measurement)*

### M15 — [ ] draft-preview

**Surface:** `.claude/skills/draft-preview-specialist/` — how unpublished content is rendered for an authorized reader only.
**Dependencies:** M1, M2
**Definition of done (all must hold):**

- [ ] `.claude/skills/draft-preview-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M15` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `draft-preview` *(to fill — awaiting measurement)*

### M16 — [ ] multi-zone

**Surface:** `.claude/skills/multi-zone-specialist/` — how independently built applications compose behind one origin.
**Dependencies:** M3
**Definition of done (all must hold):**

- [ ] `.claude/skills/multi-zone-specialist/references/theokit-gap.md` re-measured against the surface's specification (not against a framework release), dated, and citing the package and file each row was measured in
- [ ] every row in that gap file is either closed in the published packages, or carries an ADR under `.claude/knowledge-base/adrs/` that names the row and states why it is declined
- [ ] `/acceptance M16` exercised these criteria against a build from the released tag in a clean checkout, with evidence files under `.claude/knowledge-base/acceptance/evidence/` for every criterion marked passed
- [ ] surface-specific behavioural criteria for `multi-zone` *(to fill — awaiting measurement)*

## Program completion

Closing all sixteen milestones satisfies the **parity** condition. It does not, on its own, close
the program: the second condition is **measured superiority on the agent axis**, and it is
deliberately not a milestone here because it spans every surface rather than any one of them.

The agent-axis benchmark measures ten canonical journeys — tool call, human-in-the-loop, streaming,
thread, multi-step, retry, rate limit, tenant, observability, deploy — on four dimensions:

| Dimension | Unit |
|---|---|
| Files touched | count |
| Glue lines written | count |
| Concepts required before the first run | count |
| Time to first green run | wall-clock |

It has no milestone block and no checkbox, so nothing in this file flips on it. When it is ready to
be run and graded, it earns its own milestone through `/backlog-item` and `/discover` like any
other work — not by being asserted here.

## Explicitly out of scope

- Cloning the App Router.
- Writing an in-house bundler.
- Treating RSC as a premise. If it is adopted, it is adopted through a measured ADR.
- Listing a deploy adapter nobody can exercise (`M14` grades what is exercised, not what is named).

## Cross-references

- Acceptance contract that grades these criteria: `.claude/rules/cycle-acceptance.md`
- Checkbox flip invariant: `.claude/skills/release/scripts/flip_milestone_checkbox.py`
- Session binding for a milestone: `.claude/skills/cycle-goal/SKILL.md`
- Maintenance registry: `BACKLOG.md`
