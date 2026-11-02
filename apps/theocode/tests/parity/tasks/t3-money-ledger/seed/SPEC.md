# Ledger

`ledger.mjs` exports a class `Ledger` that keeps a money balance.

1. `deposit(amount)` adds a positive amount. An amount that is zero, negative or not a finite
   number throws a `RangeError`.
2. `withdraw(amount)` subtracts a positive amount. Withdrawing more than the balance throws a
   `RangeError` and leaves the balance unchanged.
3. `balance()` returns the current balance and must not accumulate floating point error: after
   `deposit(0.1)` and `deposit(0.2)`, `balance()` is exactly `0.3`.
4. `history()` returns every accepted operation in order, as `{ type: 'deposit' | 'withdraw', amount }`.
