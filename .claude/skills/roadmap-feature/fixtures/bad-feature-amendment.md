<!--
  ANTI-PATTERN fixture for /roadmap-feature.
  Same context (AI Gateway, M0-M2 [x], M3-M8 [ ]), same feature
  (per-user rate limit), but every problem is annotated inline.
-->

<!-- BAD #1: renumbering existing milestones to "make room" for the new feature.
     The user wanted per-user rate limit "right after quota", so they
     inserted it as M3.5 and renumbered M4-M8 → M5-M9. NEVER do this. -->

### M3.5 — Per-user rate limit (was inserted between M3 and the new M5)

<!-- BAD #2: no "Added by" / date marker — provenance is invisible. -->

<!-- BAD #3: objective is a category, not an outcome. -->

**Objective:** Rate limiting.

<!-- BAD #4: DoD bullets are vibes, not verifiable conditions. -->

**Definition of done:**

- [ ] Rate limit works.
- [ ] Users are limited.
- [ ] No regressions.

<!-- BAD #5: empty dependencies block — cycle-roadmap cannot schedule. -->

**Dependencies:** (TBD)

<!-- BAD #6: no risks identified. Real features carry real risks; empty = lazy. -->

**Top risks:**

(none — should be fast to ship)

<!-- BAD #7: no "why now" justification — milestone appears without context. -->

---

<!--
SUMMARY OF EVERY THING THIS FIXTURE GETS WRONG (and corresponds to roadmap-feature anti-patterns):

#1 — Renumbering. The original M4..M8 became M5..M9 to "make room" for M3.5. Every plan,
     run-file, and audit trail that references M4 now points at the wrong milestone. Anti-pattern #1.

#2 — No insertion provenance. Without `Added 2026-08-12 by /roadmap-feature`, future maintainers
     cannot tell if this milestone was in the original roadmap or amended later. Anti-pattern #11.

#3 — Vague objective. "Rate limiting" is a topic, not an outcome. Compare with the good fixture:
     "...so a single noisy user inside an org cannot starve other users of the same org." 

#4 — Unverifiable DoD. "Rate limit works" is not a contract — there is nothing for cycle-release
     to check. Anti-pattern #5.

#5 — Empty dependencies. cycle-roadmap cannot pick this milestone because dependency state is
     unknown. Skill default ("most recent [x]") should have been applied or overridden explicitly.
     Anti-pattern #6.

#6 — No risks. Per-user enforcement on shared infra (Redis) always has cardinality + hot-key
     risks. Empty risk block = nobody thought about it. Anti-pattern #5 (looser variant — DoD also empty).

#7 — No "why now". Without grill Q1, future maintainers cannot tell why this feature jumped
     in line. If the incident that triggered it is not recorded here, the lesson is lost.

#8 (implicit) — Out-of-scope cross-check was skipped. The original roadmap had "per-user
     enforcement" in out-of-scope. By inserting M3.5 silently, the contradiction with prior
     intent was never surfaced. Anti-pattern #4.

#9 (implicit) — CHANGELOG was not updated. The roadmap was amended without a [Unreleased] entry.
     Unbreakable Rule 6 violated. Anti-pattern #8.

The result: a roadmap that nobody trusts. M5 means M5-old to half the team and M5-renumbered
to the other half. Nobody knows what is in scope vs out anymore. The audit trail is corrupted.
-->
