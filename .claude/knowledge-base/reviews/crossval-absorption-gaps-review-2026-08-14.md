# Review: crossval-absorption-gaps

**Date:** 2026-08-14
**Range reviewed:** `b86b69b4^..HEAD` (12 commits, branch `workspace`)
**Upstream verdict consumed:** code-quality `PASS` (cap 100, zero findings)
**Verdict:** `READY_TO_MERGE`

## How this review was run

Two independent specialists, spawned in parallel with no sight of each other's work:

| Reviewer | Lens | Method |
|---|---|---|
| architecture | G1 direction, SOLID, error handling, YAGNI, G6 size, G7 exports | read every diff, then read the surrounding modules |
| test + security | edge-vs-negative coverage, vacuous assertions, concurrency honesty | **broke the production code and watched whether the suite noticed** |

The second method is what made this review worth running. Reading tests tells you what
they claim; breaking the code tells you what they detect. Four security-relevant
assertions were tamper-tested; **three correctly failed and one stayed green**, and that
one green is where the only real defect in the slice was hiding.

## Findings

| # | Sev | Finding | Outcome |
|---|---|---|---|
| 1 | HIGH | Temp-file name collides across concurrent writers | **fixed** |
| 2 | HIGH | `agents_readme_has_substance` measured length, not truth | **fixed** |
| 3 | MEDIUM | Inherited observer failures were silently swallowed | **fixed** |
| 4 | MEDIUM | `secure-store` re-exported from the `./hooks` barrel with no consumer | **fixed** |
| 5 | MEDIUM | G7 register assertion grepped the gate's source instead of running it | **fixed** |
| 6 | MEDIUM | `concurrent_grants` asserted only `size > 0` | **fixed — strengthened to `=== 12`** |
| 7 | MEDIUM | "no negative case for a grant on a different tool" | **refuted — `grant_is_tool_specific` exists** |
| 8 | LOW | The file's one `as` cast carried no justification | **fixed** |
| 9 | INFO | Two example CHANGELOGs deleted inside an unrelated commit | **investigated — action correct, message was not** |

BLOCKER: **0**. HIGH: **2, both fixed rather than mitigated**.

### 1 — HIGH — the temp file was not unique (found by tamper-test)

Removing the final `chmodSync` from `writeSecureJson` failed **no test**. Pulling that
thread found something larger than the missing test.

The staging file was named `Date.now()` + pid. Measured: **twelve writes from one process
produced one name.** Two writers then race on the same path, and the second `rename` of an
already-renamed temp throws `ENOENT`.

Reachability, stated honestly: synchronous calls on a single thread serialise and never
collide — which is exactly why the suite was green. `worker_threads` share a pid and do
not serialise. Latent, not theoretical.

It is also a direct `system-design-guardrails.md` **G8** violation I had introduced: a
clock is a poor source of identity, precisely because two events can share one.

Fixed with `randomUUID()`, and uniqueness is now a property asserted head-on — 1000
generations, 1000 distinct paths — rather than one hoped for. Tamper-tested in both
directions: restoring the old name fails the new test with *"1000 writes produced 3
distinct temp path(s)"*.

**A correction this surfaced.** My own comment justified the final `chmod` with "an
existing target may have a wider mode". Measured, that is **false**: `rename` replaces the
target inode, so the old mode never survives to be repaired. The real uncovered case is a
temp that already exists (`writeFileSync` ignores `mode` on an existing file) — which the
unique name now makes unreachable. The line stays as defence in depth, relabelled
honestly instead of resting on a mechanism that does not hold.

### 3 — MEDIUM — the swallowed observer

Fire-and-forget observers must not fail the turn or block each other; that part was right.
But the `catch` was mute, and a notifier that never fires reads exactly like one with
nothing to report. That "declared, wired, never runs" shape is the defect this entire
slice existed to hunt — it does not get an exemption inside it. Now warns with the
package's established prefix.

### 4 — MEDIUM — narrowing the surface while it is still free

`./hooks` re-exported `ensureSecureDir` / `readSecureJson` / `writeSecureJson` with no
caller through the barrel (**G7**), and publishing permission-and-atomic-replace primitives
invites a consumer to hand-roll a third store instead of composing the two that exist —
the opposite of why the helper was extracted. Removed. Widening later is additive;
narrowing after a release is not, which is why the moment to decide was before shipping.

### 9 — INFO — investigated rather than assumed

Commit `1a6852fe` deleted `examples/*/CHANGELOG.md` (170 lines) under a message about the
parity gate. Checked before judging: `examples/` held **only** those two files — the
example apps were removed in `efe63edf` (v0.4.0) and their changelogs had dangled ever
since. The deletion was correct cleanup; the commit message was the defect. Recorded, not
reverted.

## Hard gates

| Gate | Result |
|---|---|
| Tests green on the branch | 1269 passed, 3 skipped, 157 files |
| Type errors | 0 (`tsc --noEmit`) |
| Lint | 0 errors, 0 warnings |
| Secrets committed | none (scan clean on every commit) |
| Direct commits to `main` / `develop` | none — every commit on `workspace` |
| `Co-Authored-By` trailers | 0 |
| CHANGELOG updated | yes, per phase, plus this review's entries |
| Dependency direction | no cycle across 30 packages |
| Surface parity | 1/6 applicable decided, 5 in warn mode with a 2026-11-12 sunset |

## What this review does not claim

- **G12 is untouched.** `@theokit/tui` U-8/U-9 live in a sibling repo and ship as a
  separate PR by declared design (plan D7). The register skips that assertion loudly.
- **T5.2 was split out, not done.** 459 undecided symbols against D8's threshold of 40
  fired the plan's own split trigger. The forcing function is the sunset, and the sunset
  has a test.
- **The non-TheoCloud adapters were not exercised.** Out of this slice's scope and, per
  the Ecosystem rules, not team-validated regardless.

## Verdict

`READY_TO_MERGE` — no BLOCKER, and both HIGH findings were fixed at the root with
regression tests rather than mitigated in prose. Proceed to `cycle-release`.
