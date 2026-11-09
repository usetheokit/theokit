# Independent audit cost (B-423)

`rules/review-auditors.txt` declares a $20 ceiling per item across all passes, with the
B-420 cost evidence and reason for the choice. A full six-specialist selection reserves
$10; the remainder is available for fixes. The runner conservatively charges the whole
reservation even if an invocation fails or spends less. Exhaustion stops the runner;
starting another ledger for the same item defeats the ceiling and is not a continuation.

Run from the repository root with a Claude CLI that supports `--max-budget-usd` and the
selected loop auditor plugins installed:

```sh
node scripts/review-auditors.mjs B-423 BASE_SHA /persistent/reviews/B-423.json HEAD
node --test tests/review-auditors/review-auditors.test.mjs
```

Use one persistent state file per item, outside the checkout. Commit fixes before running
the next pass. The first pass selects owners from BASE_SHA..HEAD; later passes select
owners from the last successfully invoked pass's head to HEAD. Each auditor still reads
the original item range for context. Renames include both paths; rewound history is refused.
The lock prevents simultaneous writers; inspect interrupted state before removing a stale
lock. An interrupted pass retains its reservation and repeats its selection on retry.

Test files belong to the test auditor rather than the surface auditor. Security, infra,
and performance matches can add their specialists. Other package/app code and public docs
belong to surface closure; unmatched files get delivery review. Domain ownership is declared
in the rules; extend it when new domains appear. Do not layer `loop-code-review`'s six
specialists or duplicate domain `/review` roles onto these independent specialist runs.

A completed invocation is not an approved review. Read the reports, including budget
exhaustion/incomplete conclusions, and resolve findings before acceptance. The state records
invocations and budget reservations, not review verdicts. The dollar limit depends on the
CLI enforcing its budget flag; real provider billing and live plugin behavior were not
verified offline.

## Real-item offline replay

The deterministic test replays the existing B-429 fix `e3d90dc3` (“write test probe files
to a temp directory, not packages/”). It first records a prior pass at `e3d90dc3^`, then
advances to the fix. Git supplies the actual changed paths: 14 test files, including
`tests/unit/test-probes-outside-src-429.test.ts`. The fix invokes only `loop-test-audit`
with `--max-budget-usd 2`; another pass at the same head invokes nothing. The invocation
is a recording double, so this proves domain selection and budgeting on a real change,
not a live independent audit or its findings. No parity ledger status is changed.
