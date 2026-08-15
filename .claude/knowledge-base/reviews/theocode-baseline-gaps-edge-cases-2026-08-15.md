# Edge Case Review — theocode-baseline-gaps (discovery plan)

Date: 2026-08-15
Plan: `.claude/knowledge-base/discoveries/plans/theocode-baseline-gaps-plan.md` v1.0
Questions analysed: 6 · ADRs analysed: 5
Cases found: 7 (EDGE: 3, NEGATIVE: 4 | MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 2)

---

## MUST FIX

### EC-1: ADR-2's evidence class (a) is nearly unsatisfiable, so the gate collapses into prose

- **Affected:** ADR-2, and every `absorb` verdict downstream
- **Kind:** NEGATIVE (the gate accepts input it was written to reject)
- **Family:** Format
- **Scenario:** ADR-2 accepts either *(a) a second observed implementation* or *(b) a stated
  structural reason that does not mention TheoCode*. TheoCode is the **only** consumer of this
  framework at agent-app scale — measured across the repo group, nothing else builds a terminal
  agent on it. So (a) will almost never be available, every verdict falls through to (b), and (b)
  is free-form prose. The ADR was written precisely because *"an agent asked to justify absorbing
  something will always find a reason"* — and as written, prose is the accepted answer.
- **Impact:** The strongest gate in the plan catches nothing. Every subsystem gets absorbed on a
  well-written sentence, which is the failure mode this plan exists to avoid.
- **Fix:** narrow (b) — it must name a **specific external agent** (Claude Code, Codex CLI,
  Aider, OpenCode, Gemini CLI) **and the concrete behaviour** it exhibits, not an abstract reason.
  "Every terminal agent resumes sessions" is prose; "Claude Code's `--resume` and Codex CLI's
  `resume` both restore a prior thread" is an observation that can be checked and refuted.

### EC-2: the in-scope counts are directory entries, not modules — and one entry is a subdirectory

- **Affected:** § In-scope table; Q1 and Q3's stop conditions
- **Kind:** EDGE (a valid `ls` at the boundary of what it means)
- **Family:** Input
- **Scenario:** the counts came from `ls | wc -l`. Measured for `session/`: 9 entries = **6**
  non-test modules + 2 test files + **1 subdirectory (`gc/`)** that `ls` did not descend into.
  A budget sized against "9 modules" is sized against the wrong number, and `gc/` — garbage
  collection of sessions, squarely in scope — is invisible to a pass that reads the 9 entries.
- **Impact:** under-reads a subsystem while believing it was covered; `gc/` silently skipped.
- **Fix:** restate counts as non-test modules, recursively, and name `session/gc/` explicitly in
  the in-scope table.

### EC-3: `covered` verdicts compared against `dist/*.d.ts` inherit the #283 failure mode

- **Affected:** Q1, Q3, Q5 (all three methods say "compare against the published `.d.ts`")
- **Kind:** NEGATIVE (comparing against a stale or filtered artefact)
- **Family:** State
- **Scenario:** the `.d.ts` is a *filtered* view of source — `stripInternal: true` removes
  declarations whose JSDoc names the internal tag. That is not hypothetical here: it is exactly
  how `providerFromApiKeyPrefix` shipped at runtime and could not be imported (#283, fixed in
  `@theokit/sdk@4.52.1`). A capability present in source but absent from the `.d.ts` would be
  read as "we don't have it" → verdict `absorb` → we rebuild something we already ship.
  Measured now: `packages/agents/dist/index.d.ts` is fresh (0 source files newer), so staleness
  is not currently realised — but the *filtering* problem is structural and independent of that.
- **Impact:** false `absorb` verdicts. The plan would prescribe rebuilding a shipped capability.
- **Fix:** compare against `packages/*/src` barrels as the primary source of truth, and treat a
  source-vs-`.d.ts` divergence as its own finding (it is a real defect, of the #283 class).

---

## SHOULD TEST

### EC-4: a capability may straddle the in-scope / out-of-scope line

- **Kind:** NEGATIVE
- **Scenario:** an in-scope module's behaviour is only intelligible by reading a module the plan
  excluded (e.g. `session/` calling into the already-migrated `auth/`).
- **Suggested check:** when classification requires it, follow the call **one hop** into
  out-of-scope code for reading only — and record the hop. Do not re-audit the out-of-scope module.

### EC-5: Q3 assumes every component declares a props interface

- **Kind:** EDGE
- **Scenario:** a component typed inline (`({a, b}: {a: string})`) or with no props has no
  interface to read; the method as written returns nothing and the row silently goes unfilled.
- **Suggested check:** fall back to the function signature; a component with no props is a
  finding in itself (it renders fixed content and is almost certainly product-specific).

---

## DOCUMENT

### EC-6: the baseline is a moving target

- **Kind:** NEGATIVE
- **Accepted risk:** TheoCode is an actively-developed sibling — its `develop` advanced during
  this very session. `file:line` citations can drift between the read and the review.
- **Mitigation (cheap, so take it):** record TheoCode's git SHA at the start of `/discover-execute`
  and state it in the blueprint header. Drift then becomes visible instead of silent.

### EC-7: absence of a capability in the framework is not the same as a gap

- **Kind:** EDGE
- **Accepted risk:** G11 (YAGNI) says "TheoCode has it" is not a reason for us to. A subsystem
  can be genuinely absent from the framework *and* correctly absent. The blueprint's verdict
  vocabulary already allows `product-policy`, and the risk is that it goes unused because
  `absorb` is the more satisfying answer. Named here so the reviewer can check the distribution:
  a blueprint where every row says `absorb` has not applied the rung-1 question.

---

## Summary

| Question | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|---|
| Q1 (session) | 1 | 1 | 2 | 1 | — |
| Q2 (delegation) | — | — | — | — | — |
| Q3 (TUI) | 1 | 1 | 2 | 1 | — |
| Q4 (tests) | — | — | — | — | — |
| Q5 (deps) | — | 1 | 1 | — | — |
| Q6 (tools) | — | — | — | — | — |
| ADR-2 (cross-cutting) | — | 1 | 1 | — | 1 |
| Plan-wide | 1 | — | — | — | 1 |

**Coverage check:** every question touching an input boundary (Q1, Q3, Q5 — all three read an
external artefact) has at least one EDGE and one NEGATIVE case considered. Q2/Q4/Q6 read the same
artefacts through the same methods and inherit EC-2/EC-3.

**Verdict:** PLAN NEEDS ADJUSTMENT — EC-1, EC-2, EC-3 to be absorbed into v1.1 before
`/discover-plan-confidence`.
