# knip cannot complete on this repository, so D1 asserts nothing and the cap is dismissed

<!-- ADR-DISMISS-SOFT-CAP: auditor_unavailable_knip: knip aborts with SIGABRT after exhausting 6 GB of heap on this repository; measured twice, filed as B-296 -->
<!-- ADR-DISMISS-SOFT-CAP: auditor_output_malformed_knip: the SAME crash reached through the other code path — knip dies mid-output, so its stdout does not parse as JSON; see § Two ids, one condition -->

- **Date:** 2026-09-24
- **Status:** accepted
- **Item that forced the decision:** B-273
- **Cap dismissed:** `auditor_unavailable_knip` (`FAIL_SOFT`, score cap 70)

## What was measured

`/code-quality` returns `FAIL_SOFT` on this repository with exactly one soft cap. Its cause is not the
code — the finding names no file, which is how `code-quality-golden-rule.md § 4.1` separates a finding
about the CODE from one about the GATE.

```
npx knip --no-progress                              exit 134 (SIGABRT)  MAXRSS 4 493 980 KB   99.76s
NODE_OPTIONS=--max-old-space-size=6144 npx knip     exit 134 (SIGABRT)  MAXRSS 6 701 376 KB  138.37s
                                                    FATAL ERROR: Reached heap limit
```

Both runs were taken with nothing else of this session competing, 7 GB of machine memory available.
Raising the ceiling did not fix it: knip consumed all 6 GB and died further in. So it is a property of
this repository plus this tool, not of the machine's load and not of the change under review.

## The decision

Proceed to `/review` with the cap dismissed, and file the underlying defect as its own item.

## Who is affected

Everyone running `/code-quality` on `theokit`, and everyone running `pnpm knip` or `pnpm check:all` —
the same wall stands in all three, because the crash is knip's and not the gate's. Detector D1 (dead
code) therefore asserts nothing about this repository today, and has not since before this item.

## What would break, and what would not

Dismissing this cap does NOT claim the repository has no dead code. It claims **nobody measured**, and
that is the honest reading of an unavailable auditor. Everything D1 would have caught remains
uncaught: an exported symbol with no caller and no test would pass unnoticed.

What does not break is the rest of the gate. D2 (symbol fabrication) ran and reported INFO — disabled
by `--no-network`, which is itself declared. D3 reports honestly that this repository declares no
public surface for it to audit. D4's mutation cap is separately allowlisted. No hard cap fired, and
`hard_caps_triggered` carries only this same id, which is the soft one.

## What was rejected

- **Fixing knip here.** It is not this item's scope, the two measurements above show it is not a
  one-line heap flag, and a change to the repository's tooling inside a probe fix is the scope creep
  `cycle-plan` refuses. Filed as **B-296** with both measurements.
- **Disabling TypeScript in `code-quality-languages.txt`.** That would remove D2, D3 and D4 as well to
  silence D1 — switching off a gate to pass it, which `autonomy-envelope.md` floor 3 forbids by name.
- **Baselining it.** `code-quality-golden-rule.md § 4.1` states in its own words that a baseline
  records findings about the CODE and never about the GATE, and names `d2_disabled_no_network` as the
  exact kind of entry that must not be written. This finding is of that kind.
- **Waiting for memory.** Already tested: the second run had the machine to itself.

## What ends this dismissal

B-296 shipping. When `pnpm knip` completes on this repository, D1 starts asserting something about the
code and this ADR stops applying — it dismisses one measurement that did not happen, not a class of
them.

## Two ids, one condition — added 2026-09-24 after the second id fired

The first run of this gate reported `auditor_unavailable_knip`; a later run on the same tree reported
`auditor_output_malformed_knip`, and this ADR named only the first. Both are dismissed now, and the
reason is that they are **one fact reached through two code paths**, not two problems:

| id | emitted when | `typescript.py` |
|---|---|---|
| `auditor_unavailable_knip` | the process exits above 1 — `_auditor_unavailable()` on a non-zero exit, a timeout, or a missing binary | `:61`, `:63`, `:65` |
| `auditor_output_malformed_knip` | the process produced stdout that `safe_parse_json` rejects | `:75-86` |

A heap abort can land on either side of that line depending on how far knip got before `FATAL ERROR:
Reached heap limit` — it writes its stack to the stream, so the JSON is truncated rather than absent.
Measured on this repository: exit 134 with `MAXRSS 4 493 980 KB` at the default heap and
`MAXRSS 6 701 376 KB` under `--max-old-space-size=6144`, both `Reached heap limit`.

**This is not a widening of the dismissal.** Neither id is a finding about the code — both carry
`file_path="."`, which is how `code-quality-golden-rule.md § 4.1` separates a finding about the CODE
from one about the GATE. What is dismissed is the same absent measurement under both labels the
detector can emit for it. B-296 remains the item that ends it.

**What this cost, stated:** an ADR that names one of two ids for one condition passes the gate on some
runs and not others, with nothing in the output saying why. That is worse than not dismissing at all,
because the failure looks like a change in the code. Found by the gate refusing a plan an hour after
the ADR was written.

