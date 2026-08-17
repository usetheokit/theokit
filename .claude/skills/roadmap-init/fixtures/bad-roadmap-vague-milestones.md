# AI Gateway — Roadmap

<!--
ANTI-PATTERN FIXTURE. This is what NOT to produce.
Each problem is annotated inline (HTML comments) so the contrast with
good-roadmap-ai-gateway.md is explicit.
-->

## Vision

<!-- BAD: marketing speak. No concrete pain, no concrete user. -->

Build the best AI gateway in the world to enable our teams to ship AI features faster.

## Problem

<!-- BAD: assumes the problem is obvious. Skips "whose pain". -->

LLM integration is hard.

## Users

<!-- BAD: "everyone" is the same as "nobody". -->

Everyone in the company who uses AI.

## Scope

### In scope

<!-- BAD: every bullet is a category, not a deliverable. -->

- Backend
- Frontend
- Observability
- Security
- Performance

### Out of scope

<!-- BAD: empty out-of-scope is the strongest signal that scope is uncontrolled. -->

(to be defined later)

## Constraints

<!-- BAD: "use best practices" is not a constraint, it is a wish. -->

- Use best practices.
- Be fast.
- Be reliable.
- Make it scalable.

## Success criteria

<!-- BAD: not measurable. No number, no time bound. -->

Users are happy with the gateway.

---

## Milestones

<!-- BAD: 12 milestones. Cap is 9. This is a backlog disguised as a roadmap. -->

### M1 — Backend

<!--
BAD:
- "Backend" is a layer, not a milestone.
- No DoD.
- No dependencies.
- No risks.
- No checkbox.
-->

Build the backend.

### M2 — Frontend

Build the frontend.

### M3 — Database

Set up the database.

### M4 — Auth

Add authentication.

### M5 — Logging

Add logging.

### M6 — Monitoring

Add monitoring.

### M7 — Caching

Add caching.

### M8 — Performance

Improve performance.

<!-- BAD: "improve performance" without a target is just vibes. M5/M8 in good fixture have explicit P95 ms numbers. -->

### M9 — Documentation

Write documentation.

### M10 — Testing

Add more tests.

<!-- BAD: tests are not a milestone — they are part of every milestone's DoD. -->

### M11 — Refactor

Clean up code.

<!-- BAD: refactor is not a milestone — it is continuous work. -->

### M12 — Launch

Launch to production.

<!-- BAD: "launch" without acceptance criteria = ship and pray. -->

---

## References

<!-- BAD: no references at all. The whole point of /roadmap-init is to seed SOTA peers. -->

TBD.

---

<!--
SUMMARY OF EVERY THING THIS FIXTURE GETS WRONG:

1. Vision is marketing speak; no concrete pain, no concrete user.
2. Problem statement omits "whose pain".
3. Users = "everyone" (= "nobody").
4. In-scope items are categories (Backend, Frontend) not deliverables.
5. Out-of-scope is empty — guaranteed scope creep.
6. Constraints are wishes ("be fast"), not constraints.
7. Success criterion is not measurable.
8. No north-star metric at all.
9. 12 milestones — exceeds the M0-M8 cap.
10. Milestones are layers (Backend / Frontend / Database), not value deliveries.
11. No Definition of Done per milestone.
12. No dependencies between milestones.
13. No risks identified per milestone.
14. No checkboxes — progress is invisible.
15. M0 walking-skeleton missing entirely.
16. "Refactor" and "Testing" listed as milestones (they are continuous work).
17. "Launch" with no acceptance criteria.
18. Zero SOTA references — the whole reason this skill exists.

A roadmap like this gives the team permission to drift. Within three months,
half the milestones will be reinterpreted, the "backend" milestone will have
ballooned, and the "launch" will keep slipping with no objective gate to
push back on.
-->
