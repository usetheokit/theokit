# 0023: A run budget refuses `NaN`, and a budget of 0 or below stops before the first round

- Status: Accepted
- Date: 2026-10-09
- Deciders: the repository owner, through the B-409 review (plan `agents-max-cost-usd`)

## Context

`@theokit/agents` takes a USD ceiling in three places: the run option `budget` of `AgentRunner.run`
and `stream` (a number, or since B-409 `{ maxCostUsd }`), and the `budget` and
`parentBudgetRemaining` options of `delegate()`, which `createDelegateTool` forwards. Up to 15.1.1
none of them was validated. The loop compared the spend with the ceiling after each round, so:

- `NaN` disabled the ceiling. Every comparison with `NaN` is false, and `delegate()` folds both
  options with `Math.min`, which returns `NaN` when either side is `NaN`. `Number(process.env.X)` on
  an unset variable produces exactly this value.
- 0 or a negative value ran one round, paid for it, and then threw `DelegationBudgetExceededError`.
  For `parentBudgetRemaining` this is the ordinary state of a parent that has spent its ceiling, or
  overshot it by the one round the post-round check allows.
- `Infinity` meant no ceiling. The loop uses it as its own default, and a remainder computed from a
  parent with no ceiling (`(ceiling ?? Infinity) - spent`) evaluates to it.

During B-409 the review fixes went further and refused 0, negatives and `Infinity` with
`DelegationError` on every on-ramp. The 2026-10-09 review found that this broke callers of a 15.x
minor: a spent parent now reported `delegation_failed` instead of `delegation_budget_exceeded`
through the delegate tool, and an unbounded parent's remainder was refused outright.

## Decision

All three options are read by one function, `resolveRunBudget` in
`packages/agents/src/loop/run-budget.ts`, before any hook or round:

| Input | Result |
| --- | --- |
| absent, `undefined`, `null`, `Infinity` | no ceiling, as before |
| a number above 0 | the ceiling, as before |
| 0 or below, including `-Infinity` | `DelegationBudgetExceededError` before the first round, `actualCost` 0, `budgetLimit` the value |
| `NaN`, or not a number | `DelegationError` naming the field |
| `{ window }` | `DelegationError` naming the field (new option, never accepted) |

## Considered options

1. **The table above** (chosen). A budget with nothing left keeps the error class and the delegate
   tool code it always produced; the change is that the round it used to pay for is not paid. That
   is the purpose of B-409, which stops a run before the round that would exceed its ceiling.
   `NaN` is the one input whose outcome changes class, because the old outcome was a ceiling that
   read as set and enforced nothing.
2. **Accept every number unchecked, as 15.1.1 did.** Rejected: keeps `budget: NaN` silently
   unbounded, which is the cost overrun the option exists to prevent.
3. **Refuse 0, negatives and `Infinity` with `DelegationError`** (what the B-409 review fixes did).
   Rejected: a spent parent reads as a malformed option, a consumer catching
   `DelegationBudgetExceededError` to handle exhaustion misses it, and a computed unbounded
   remainder is refused.

## Who is affected

Searched `packages/` and `apps/` outside `packages/agents` for `budget`, `parentBudgetRemaining`,
`maxCostUsd` and `createDelegateTool` on 2026-10-09: no caller in this repository passes a USD
ceiling. The affected callers are external users of `@theokit/agents`:

- a caller passing `NaN` (for example from an unset environment variable) now gets
  `DelegationError` before any round, where the run used to go unbounded;
- a caller passing 0 or a negative value now gets `DelegationBudgetExceededError` without paying
  for a round, and its message says the run stopped before its first round;
- nothing changes for a positive finite value, `Infinity`, or no budget.

## Consequences

- Shipped in the B-409 minor changeset of `@theokit/agents`, which states both changed inputs.
  Treated as a minor: the only input whose result changes class was a defect that capped nothing.
- `DelegationBudgetExceededError` gains a third refusal wording, "stopped before its first round:
  its $X limit leaves nothing to spend".
