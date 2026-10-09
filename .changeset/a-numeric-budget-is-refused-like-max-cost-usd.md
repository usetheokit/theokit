---
'@theokit/agents': minor
---

The run option `budget` given as a number is now refused on the same terms as `{ maxCostUsd }`: 0, a negative value, `NaN` or an infinite value throws a `DelegationError` naming `budget` before any round, where it used to be accepted unchecked. `budget: NaN`, for example from `Number(process.env.MAX_COST)` on an unset variable, read as a ceiling and enforced none, and `budget: 0` was charged one round before it raised. A caller that passed `Infinity` or `NaN` to mean "no ceiling" should leave `budget` out instead. (B-433)
