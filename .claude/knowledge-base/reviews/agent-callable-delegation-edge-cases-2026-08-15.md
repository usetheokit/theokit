# Edge Case Review — agent-callable-delegation

Date: 2026-08-15
Plan: `.claude/knowledge-base/plans/agent-callable-delegation-plan.md` v1.0
Tasks analysed: 2
Cases found: 6 (EDGE: 2, NEGATIVE: 4 | MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 1)

---

## MUST FIX

### EC-1: the plan never says where the API key comes from — every real delegation throws

- **Affected task:** T0.1
- **Kind:** NEGATIVE (invalid state reachable through the documented happy path)
- **Family:** Input
- **Scenario:** `delegate()` calls `requireApiKey` at `agent-orchestrator.ts:128` and throws
  `DelegationError(agentName, 'No API key provided. Pass apiKey in DelegateOptions.')` when
  `opts.apiKey` is empty. The plan's D4 says the handler "resolves a name and calls `delegate()`" and
  its `DelegateOptions` surface is only mentioned as `defaults`. A factory built exactly as specified
  passes `{}` and every delegation fails at the first call — while the tests stay green, because D2
  routes them through a `DelegationPort` double that never reaches `requireApiKey`.
- **Impact:** the feature is dead on the real path and the suite cannot see it. This is precisely the
  "green by absence" failure this repo has hit before.
- **Fix:** make `defaults: DelegateOptions` an explicit, documented factory option, and add a test
  asserting that a `SubAgentSpec` roster without an `apiKey` fails **at factory time** with a named
  error rather than at the model's first call.

### EC-2: a roster keyed by `SubAgentSpec.name` can hold duplicates, and the enum silently collapses them

- **Affected task:** T0.1
- **Kind:** NEGATIVE
- **Family:** Format
- **Scenario:** the roster is a list of `DelegationTarget`. Two entries with the same `name` produce
  a `z.enum` with a repeated member — Zod accepts it, the duplicate vanishes, and lookup resolves to
  whichever the implementation happens to find first. The model sees one name and gets a
  non-deterministic target.
- **Impact:** silent wrong-agent dispatch. Worse than a crash, because it looks like it worked.
- **Fix:** reject duplicate names at factory time with the same typed error as the empty roster
  (R4), and test it. `Toolset` already refuses `duplicate_tool` — same rule, same shape.

---

## SHOULD TEST

### EC-3: `DelegationPort` has no `name`, so a port-only roster cannot build the enum

- **Kind:** EDGE
- **Scenario:** `DelegationTarget = SubAgentSpec | DelegationPort`, and `DelegationPort` is
  `{run(message)}` — no `name` field. D2 accepts ports, D1 builds the enum from names. A roster of
  bare ports has no names to enumerate.
- **Suggested test:** `test_a_port_roster_requires_an_explicit_name` — the roster entry shape must
  carry the name alongside the target (e.g. `{name, target}`), asserted at factory time. This also
  keeps the two branches of the union from needing a type guard at every use.

### EC-4: an empty `task` string reaches `delegate()` as an empty prompt

- **Kind:** EDGE (smallest valid-looking input)
- **Suggested test:** `test_an_empty_task_is_rejected_by_the_schema` — `z.string().min(1)` is already
  in the plan; the test pins it so a future schema edit cannot quietly drop it.

### EC-5: the handler's return must be a string, and `DelegationResult` is an object

- **Kind:** NEGATIVE
- **Scenario:** `CustomTool.handler` returns `string | Promise<string>`; `delegate()` resolves a
  `DelegationResult`. Returning the object directly is a type error at best and `"[object Object]"`
  reaching the model at worst.
- **Suggested test:** `test_the_result_is_serialised_for_the_model` — assert the handler's return is
  a string and that it carries the sub-agent's text, not a stringified object shell.

---

## DOCUMENT

### EC-6: R1's recursion mitigation is only as strong as the caller's budget

- **Kind:** NEGATIVE
- **Accepted risk:** the plan mitigates delegate-tool recursion by relying on `delegate()`'s budget
  clamp. That holds only when the caller passes a `budget`/`parentBudgetRemaining`; both are optional
  in `DelegateOptions`. With neither set, recursion is bounded by nothing this layer controls.
  Documented rather than fixed: adding a depth counter here would put a second owner on a rule
  `delegate()` already owns (D4/G12). The honest statement is that the guarantee is conditional, and
  the factory's docblock must say so instead of implying an unconditional bound.

---

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|---|
| T0.1 | 2 | 4 | 2 | 3 | 1 |
| T0.2 | — | — | — | — | — |

**Coverage check:** T0.1 is the only task touching an input boundary; it now carries both lenses —
EDGE (empty task, port-without-name) and NEGATIVE (missing key, duplicate names, wrong return type,
unconditional recursion claim).

**Verdict:** PLAN NEEDS ADJUSTMENT — EC-1 and EC-2 absorbed into v1.1 before `/plan-confidence`.
