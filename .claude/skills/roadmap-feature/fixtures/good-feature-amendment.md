<!--
  GOOD fixture for /roadmap-feature.
  Continuation of the AI Gateway roadmap (see /roadmap-init good fixture).
  At amendment time: M0-M2 are [x], M3-M8 are [ ].
  Feature being added: per-user rate limiting, requested by Security after
  a noisy-neighbor incident on M2 production.
-->

### M9 — [ ] Per-user rate limit enforcement

> Added 2026-08-12 by `/roadmap-feature` (slug: `per-user-rate-limit`). See CHANGELOG `[Unreleased] § Added`.

**Objective:** Add per-user rate-limit enforcement on top of existing per-org and per-project quotas (M3), so a single noisy user inside an org cannot starve other users of the same org.

**Definition of done:**

- [ ] Rate-limit config in Postgres per (org, user_id) with per-minute and per-hour windows.
- [ ] Redis counters incremented per request keyed on `(org, user_id, window)`.
- [ ] Hard-cap exceedance returns 429 with `X-User-Limit-Reset` header (mirrors M3's `X-Quota-Reset`).
- [ ] Soft-warn (80%) emits warning header without blocking.
- [ ] Admin endpoint exposes per-user limit state for on-call inspection.
- [ ] Per-user rate-limit events emitted to existing observability surface (M5 Prometheus + Grafana panel).

**Dependencies:** M3 (per-org/per-project quota — same Redis infrastructure), M5 (observability surface — for new metric labels).

> Skill-default suggested M2 (most recent `[x]`). User overrode to M3 + M5 in grill Q2 because: rate-limit reuses M3's Redis counter pattern, and the new metric labels need M5's cardinality discipline already in place.

**Top risks (new — pre-existing risks documented elsewhere in roadmap):**

1. Cardinality explosion if `user_id` enters Prometheus labels at high volume — mitigation: cap label to top-N users by request volume, others bucketed as `_other`. Decision deferred to plan (M9 `/to-plan`).
2. Backwards compatibility for callers that did not previously receive 429 from the gateway — mitigation: 14-day shadow-mode flag per org before enforcement (similar to M7 onboarding pattern).

**Why now (from grill Q1):**

Security flagged a noisy-neighbor incident on 2026-08-02: one user inside Org-Apollo issued 12k requests/min for 6 hours, exhausting the org's quota and impacting four other users on the same org. M3's per-org quota worked correctly (Org-Apollo was throttled at its cap), but the harm was already done internally. Per-user enforcement was on the v1 wishlist but went to "out of scope" because two-level (org+project) was deemed enough; this incident reverses that decision.

---

<!--
WHY THIS FIXTURE IS GOOD:

1. Milestone ID is M9 — extends past the original cap M0-M8 without renumbering anything.
2. "Why now" cites a concrete incident with date + impact — explains the strategic shift.
3. DoD bullets are verifiable from outside (admin endpoint exists / returns 429 / metric label exists).
4. Dependencies override the skill-default with explicit reasoning. M3 and M5 are both [x] at amendment
   time, so M9 becomes selectable by cycle-roadmap immediately.
5. Risks are NEW — does not repeat M3's "token-counting drift" or M5's "cardinality" risks; mentions
   cardinality only because the new label dimension matters.
6. The grill detected out-of-scope overlap with the original "per-user enforcement out of scope" line
   and the user chose "Remove from out-of-scope" — that decision is referenced in CHANGELOG and
   the original out-of-scope line was stripped by Step 6.3.
7. Auto-commit happened (tree was clean) — single atomic chore(roadmap) commit touches
   ROADMAP.md + CHANGELOG.md only.
-->
