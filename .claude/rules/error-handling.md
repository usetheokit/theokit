# Error Handling

Source of Truth for error-handling discipline (Unbreakable Rule 8). Stack-agnostic.
Fail fast, fail loud, fail clear — a swallowed error is the most dangerous bug.

## § 1 — Philosophy: fail-fast

The system should fail as early, as loudly, and with as clear a message as possible.
An error caught at input validation costs cents; the same error surfacing three
layers deep in production costs orders of magnitude more.

## § 2 — Rules

- NEVER swallow exceptions. An empty `catch {}` is forbidden. If you can't handle it, let it propagate.
- Validate inputs **at the system boundary** (controllers, consumers, handlers). Past the boundary, data is trusted.
- Errors are **explicit and typed**. Use domain errors with clear messages — `InsufficientBalanceError("account 12345: balance 100, attempted 500")`, not `Error("processing error")`.
- Distinguish **recoverable** from **unrecoverable**. External-API timeout → retry with backoff. Business-rule violation → fail immediately, no retry.
- Error logs carry enough context to reproduce without a debugger: who, when, what, with which data, expected vs. actual.
- Never use exceptions for control flow. Exceptions are for exceptional situations.
- Return explicit errors, not magic values (`-1`, `null`, `""`) to signal failure.

## § 3 — Hierarchy of handling

```
1. VALIDATE at the entry   → reject invalid data before processing
2. FAIL fast               → stop immediately when something is wrong
3. FAIL clear              → specific message with full context
4. FAIL loud               → let the error rise to who can handle it
5. LOG with context        → structured log with data for diagnosis
6. RECOVER where it makes sense → retry / fallback / circuit breaker only where justified
```

## § 4 — Relationship to other rules

- **Negative cases** (`testing.md` § 4.1) are where this rule is proven: a negative-case test asserts the *specific typed error and message*, not merely "it throws".
- `/code-quality` does NOT detect swallowed exceptions today — this is a review-time concern (`cycle-review.md`) and a future detector candidate.

## § 5 — Anti-patterns

- `catch (Exception e) { log.error("error"); }` — swallowed; nobody learns what happened.
- Returning `null` instead of raising when the operation failed.
- Generic messages: "An unexpected error occurred." For whom? About what?
- Infinite retry without backoff or circuit breaker.
- Treating every error the same — a network timeout and a business-rule violation are fundamentally different.
- Logging an error and re-raising the same exception (duplicates the log without adding value).

## Cross-references

- Schema for cycle rules: `cycle-rule-schema.md`
- Negative-case testing: `testing.md` § 4.1
- Cycles that cite this: `cycle-implement.md`, `cycle-review.md`
