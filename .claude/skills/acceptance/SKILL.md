---
name: acceptance
version: 0.1.0
requires: [release]
description: 'End-user validation of a RELEASED milestone, and the gate on its ROADMAP checkbox. Reads the milestone''s Definition-of-done bullets from ROADMAP.md as acceptance criteria, exercises each one against the actually-released delivery — deployed URL via chrome-devtools MCP, installed binary via cua-driver, published CLI/package/API via real invocations — captures evidence per criterion (screenshot, console, network, transcript), and computes ACCEPTED / ACCEPTED_WITH_CAVEATS / REJECTED / NOT_VALIDATED with a script rather than asserting it. A criterion marked passed with no evidence is refused. Only a green verdict flips the milestone [ ] → [x], which is why cycle-release no longer flips it. Invoke after /release emits RELEASED.'
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit
argument-hint: "M<N>"
---

# `/acceptance` — Validate the released delivery as its user meets it

`/review` read the diff. `/code-quality` measured the source. `/release` cut the tag. Every one of them can be green while the released product is broken for the person it was built for — because none of them ever touched the thing that shipped.

This skill does. It drives the released delivery through the milestone's own promises, records what happened, and decides whether the roadmap may claim the milestone is done.

## Cycle contract

This skill is **the only phase** of [`cycle-acceptance`](../../rules/cycle-acceptance.md). That rule is the **source of truth** for pre-conditions, the target-kind matrix, phase contracts, verdicts (`ACCEPTED` / `ACCEPTED_WITH_CAVEATS` / `REJECTED` / `NOT_VALIDATED`), hard gates, and anti-patterns. **Read it before invoking.**

## When to trigger

`/acceptance M<N>` when:

- `/release` emitted `RELEASED` for the milestone — tag cut, release published.
- The milestone's checkbox in `ROADMAP.md` is still `[ ]`.
- The released delivery is reachable at a real address.

Do NOT trigger when `/release` returned `PR_OPEN_AWAITING_APPROVAL` or `BLOCKED`, when the checkbox already reads `[x]`, or when the only thing you can reach is a local build.

## Process

### 1. Extract the criteria — before looking at the system

```bash
python3 skills/acceptance/scripts/extract_acceptance_criteria.py \
    --roadmap ROADMAP.md --milestone M2 > criteria.json
```

The criteria are the milestone's `**Definition of done (all must hold):**` bullets. Extracting them first is not a formality: criteria written after seeing the result are a moved target. Exit 1 with `NOT_VALIDATED` when the milestone declares no Definition of done or no bullets — a milestone with no stated promise cannot be accepted.

### 2. Resolve the target and its instrument

Per `cycle-acceptance § Target kinds`: web → `chrome-devtools` MCP; native app → `cua-driver` skill; CLI → install the published artifact and run it from a clean directory; library → consume the published package in a throwaway project; API → call the deployed endpoints.

Confirm the address points at the **released** artifact. Record it in the acceptance record — an auditor must be able to tell what was exercised.

### 3. Exercise each criterion

One criterion at a time, as a user meets it, not as a developer inspects it. For each:

- Drive the journey end to end.
- Capture evidence: screenshot, console messages, network requests (`METHOD URL -> status`), command transcript, response body.
- Record `status` ∈ `passed` | `failed` | `blocked` | `not_exercised`.

Read the console and network even when the UI looks fine — a swallowed 500 is exactly the class of defect that survives every earlier gate.

Log every defect observed along the way with a severity (`blocker` | `major` | `minor`). **File an issue for each one as you find it** — per the issue-reporting contract, mentioning a defect in a report without filing it is the worst outcome.

### 4. Write the record

`knowledge-base/acceptance/{milestone}-{date}.md`, plus artifacts under `knowledge-base/acceptance/evidence/`. Cite evidence by path; the paths must resolve.

### 5. Compute the verdict — do not name it

```bash
python3 skills/acceptance/scripts/compute_acceptance_verdict.py \
    --criteria criteria.json --evidence evidence.json
```

Exit 0 → `ACCEPTED` / `ACCEPTED_WITH_CAVEATS`. Exit 1 → `REJECTED` / `NOT_VALIDATED`, with per-criterion reasons on stderr. Report the token the script printed. A verdict the script did not emit is a review BLOCKER.

### 6. Flip, or do not

On a green verdict only, reusing the release slice's script so the single-flip invariant has exactly one implementation:

```bash
python3 skills/release/scripts/flip_milestone_checkbox.py \
    --roadmap ROADMAP.md --milestone-id M2 --version {released-version} \
    --plan knowledge-base/plans/{slug}-plan.md --commit
```

On `REJECTED`: the checkbox stays `[ ]`, the release is already public, so open the hotfix path immediately and re-enter at `/to-plan`. On `NOT_VALIDATED`: the checkbox stays `[ ]`; state precisely what could not be exercised and why.

### 7. Report

State the target address, the verdict token, per-criterion status, evidence paths, filed issues, and whether the checkbox flipped.

## Hard gates

- **A `passed` with no evidence is refused.** With human sign-off out of scope, recorded evidence is the only thing between a real validation and a confident sentence.
- **The verdict is computed, never asserted.**
- **No flip without a green verdict.**
- **The target is the released artifact** — never a local build, staging clone, or mock.
- **Criteria are read before the run**, from `ROADMAP.md`.
- **Every caveat is a filed issue.**

## Anti-patterns

- **Re-running the test suite and calling it acceptance.** That check passed three phases ago; it is not what this cycle measures.
- **Marking a criterion `passed` after reading the code.** Reading is not exercising. Not driven → `not_exercised`.
- **Downgrading a failed Definition-of-done bullet to a "caveat"** so the checkbox can flip. Caveats are for defects outside the declared criteria.
- **Retrying silently until it passes.** Flakiness in the live system is a finding.
- **Treating `NOT_VALIDATED` as a soft pass.** It blocks the flip exactly as `REJECTED` does.

## What this skill does NOT do

- Does not run unit, integration or e2e suites — `cycle-code-quality` and the plan's Integration Validation phase own those.
- Does not deploy, roll back, or hotfix. It reports and blocks; the fix re-enters at `/to-plan`.
- Does not decide production-readiness across releases — that is `/dogfood`, which can consume these records as evidence.
- Does not invent acceptance criteria.
- Does not ask a human to sign off. By design in this project: the gate rests on computed evidence instead. The trade-off is stated plainly in `cycle-acceptance § Hard gates`.

## Related

- [`skills/release/SKILL.md`](../release/SKILL.md) — must have emitted `RELEASED`; no longer flips the checkbox
- [`skills/dogfood/SKILL.md`](../dogfood/SKILL.md) — sustained-use honesty gate that consumes acceptance evidence
- [`skills/cycle-goal/SKILL.md`](../cycle-goal/SKILL.md) — names this phase in the milestone goal condition
- `rules/cycle-roadmap.md` — the macro loop that consumes this verdict
- `rules/testing.md` — why exercised behaviour beats asserted coverage
