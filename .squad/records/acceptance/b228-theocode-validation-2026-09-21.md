---
item: B-228
verdict: ACCEPTED_WITH_CAVEATS
target: apps/theocode (in-repo consumer) + my-test scaffold (the surface the defect lived on)
date: 2026-09-21
---

# Validation — B-228, and what each measurement does and does not prove

## theocode

| | |
|---|---|
| command | `npx vitest run` — theocode's OWN test script, not a root-level run |
| result | **254 files, 1937 passed, 6 skipped, exit 0, zero individual failures** |

**What this proves:** nothing in this session's changes broke theocode.

**What it does NOT prove, and the distinction matters:** that the B-228 fix works. It cannot,
because the change does not reach theocode. Measured rather than assumed — `apps/theocode/package.json`
declares `@theokit/agents`, `@theokit/agents-pty` and `@theokit/sdk`, and **not** `theokit`; a grep
for `theokit/vite-plugin` across `apps/theocode/src` and `apps/theocode/packages` returns zero.

A green suite over code the change never touches is evidence of no regression and nothing else.
Reporting it as validation of the fix would be the shape this whole session kept refusing.

## Where the fix WAS validated

The scaffold, in real Chrome 149, against a real build with `ssr: true` — because that is the surface
the defect lived on. Four readings, either side of the change:

| reading | before | after |
|---|---|---|
| body contains "Unexpected Application Error" | true | **false** |
| `[data-theo-scroll]` present in the live DOM | false | **true** |
| `querySelectorAll('a[href]').length` | 0 | **2** |
| `history.scrollRestoration` | auto | **manual** |

Plus the mechanical property, checkable without a browser: `displayName="Location"` in the built
client bundle went **2 → 1**.

## Caveat

A React **#418** hydration text mismatch remains, visible only because the error boundary is now
gone. Registered as **B-229** before this change was written — not appended at validation time.
