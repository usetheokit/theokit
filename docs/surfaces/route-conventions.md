# What this framework implements today, and the order to close the gap

**Measured 2026-08-20** against `packages/theo/src/router/` and `packages/theo/src/server/scan/`, by reading
the scanners rather than by trusting the previous edition of this file. Re-measure before trusting: the
scanner is the source of truth, not this file.

The 2026-08-19 edition of this file was wrong in two places, corrected below and marked where they sit:
it listed private folders as missing when the scanner has always skipped them, and it described a route
precedence defect that was fixed on 2026-08-20. Both corrections are recorded rather than edited away.

## Contents

1. [What exists](#what-exists)
2. [What is missing](#what-is-missing)
3. [Two matchers, two precedence rules](#two-matchers-two-precedence-rules)
4. [The order to close it](#the-order-to-close-it)

---

## What exists

| Convention | Status | Where |
|---|---|---|
| `page` `layout` `error` `loading` `not-found` | Implemented | `packages/theo/src/router/types.ts:5` |
| Extension priority `.tsx > .ts > .jsx > .js` | Implemented | `packages/theo/src/router/types.ts:9`, applied at `packages/theo/src/router/scan.ts:45` |
| Static / dynamic `[x]` / catch-all `[...x]` | Implemented | `packages/theo/src/router/scan.ts:75` |
| Optional catch-all `[[...x]]` | Refused at build time, message names the segment and the alternative | `packages/theo/src/router/scan.ts:69` |
| Route groups `(name)` | Implemented | `packages/theo/src/router/scan.ts:114` |
| Private folders `_name` | Implemented — **correction, see below** | `packages/theo/src/router/scan.ts:150` |
| Folders are routes only with a route file | Implemented | `packages/theo/src/router/scan.ts:96`, pruned at `packages/theo/src/router/scan.ts:155` |
| Deterministic directory order | Implemented, compared by code unit, not by collation | `packages/theo/src/router/scan.ts:142` |
| Semantic folders under the agents directory | Implemented, 13 reserved names | `packages/theo/src/server/scan/agent-scan.ts:22` |
| An agent as a folder with an index | Implemented | `packages/theo/src/server/scan/agent-scan.ts:70` |
| Server route precedence, declared | Implemented, **per segment since 2026-08-20** | `packages/theo/src/server/scan/scan.ts:215` |
| A route file must declare a `policy` per exported method | **New on 2026-08-20** — the scan fails and names the file | `packages/theo/src/server/scan/scan.ts:100`, error at `packages/theo/src/server/scan/errors.ts:98` |

**Correction to the 2026-08-19 edition.** It listed *private folders `_name`* under "what is missing",
saying applications "rely on folders are not routes". That was false in both directions: the page scanner
skips any entry beginning with `_` or `.` at `packages/theo/src/router/scan.ts:150`, the behaviour is
asserted at `tests/unit/router-scan.test.ts:70`, and the same rule is repeated by every sibling scanner —
`packages/theo/src/server/scan/middleware-scan.ts:30`,
`packages/theo/src/server/jobs/job-scan.ts:57`, `packages/theo/src/server/cron/cron-scan.ts:85` and
`packages/theo/src/adapters/static.ts:83`. The convention is not only present, it is the most consistently
implemented one on this surface.

Three decisions here are better than most implementations and worth keeping deliberately:

* **The optional catch-all is refused instead of mis-parsed.** The message names the folder and says what
  to write instead (`packages/theo/src/router/scan.ts:69`). A silent mis-parse into a param literally named
  `...slug` is the common failure; this avoids it. Precision the previous edition lacked: this is a plain
  `Error`, not a typed class. The server scanner does have typed refusals — `RouterConventionError` at
  `packages/theo/src/server/scan/errors.ts:39` and `MissingRoutePolicyError` at
  `packages/theo/src/server/scan/errors.ts:98` — and the page scanner does not yet match them.
* **Catch-all is tested before dynamic**, so `[...slug]` is never read as a param named `...slug`
  (`packages/theo/src/router/scan.ts:75` before `packages/theo/src/router/scan.ts:77`).
* **The policy gate lives in the scanner, not in the build command.** Every entry point — `build`, `start`,
  `dev`, `routes`, and each deployment adapter — reaches routes through `scanServerRoutes`
  (`packages/theo/src/server/scan/scan.ts:135`), so a gate wired into one command could be bypassed by the
  other five. The blast radius is deliberately bounded to the file system: a `RouteConfig` built in memory
  never passes a scanner and is never refused (`packages/theo/src/server/scan/scan.ts:94`).

---

## What is missing

Ordered by what applications currently write by hand because of the absence. Each row was re-checked on
2026-08-20 by searching `packages/theo/src/router/` and `packages/theo/src/server/scan/` for the
convention's reserved name; none is present in either scanner, and `packages/theo/src/router/types.ts:5`
enumerates the complete set of recognised route file names.

| Missing | What applications do instead | Cost |
|---|---|---|
| `template` | Key a layout by pathname | Throws away the layout's own state as collateral |
| Named slots `@name` | One page fetches every pane | No independent streaming, no independent failure |
| `default` | — | Not applicable until slots exist; **mandatory the day they do** |
| Intercepting routes | Track "did I arrive by clicking?" in app state | Wrong after refresh — the case users share |
| `forbidden` / `unauthorized` | Collapse into not-found | Authorised-but-forbidden users get no actionable answer |
| Segment config | Global config, or nothing | No per-route control over caching, runtime or prefetch |
| Optional catch-all | Two pages sharing logic by copy | Duplicated index logic in every docs-shaped app |

*Private folders `_name` was removed from this table on 2026-08-20 — see the correction above.*

On segment config specifically, the absence is total rather than partial: nothing in the page scanner reads
a per-route export. `packages/theo/src/router/scan.ts:40` attaches files by name and never opens them, and
the only scanner that reads a route file's source is the server one, which does so to detect exported HTTP
methods and declared policies (`packages/theo/src/server/scan/scan.ts:152`). Segment config would be the
first per-route export the page router honours, and the machinery to read one does not exist on that side.

`template` and slots are the two that unlock the most: the first is small and removes a known workaround;
the second is the prerequisite for per-pane streaming, which is a rendering capability, not only a routing
one.

---

## Two matchers, two precedence rules

Pages and API routes are matched by different code with different rules:

| Space | Matcher | Precedence |
|---|---|---|
| `app/` pages | react-router's own matcher (`packages/theo/src/router/generate.ts:15`, wired at `packages/theo/src/router/entry.ts:112`) | react-router's per-segment ranking |
| `server/routes/` | `compilePattern` (`packages/theo/src/server/scan/match.ts:12`) + first match over a sorted list (`packages/theo/src/server/scan/match.ts:40`) | Sorted once, per segment, at `packages/theo/src/server/scan/scan.ts:173` |

They govern disjoint path spaces, so this is not a bug on its own. It is a **divergence of model**: a
developer who learns one set of rules carries the wrong intuition into the other half of the same framework.
That divergence remains, and it is now the only thing this section reports.

**Correction to the 2026-08-19 edition.** It described the server tiebreak as "sorted once: static →
dynamic → catch-all, then `localeCompare`", called out `/api/:resource/settings` winning over
`/api/users/:id`, and made "per-segment precedence" step 1 of the closing order. **That defect was fixed on
2026-08-20 and the step is done.** `compareRouteSpecificity`
(`packages/theo/src/server/scan/scan.ts:215`) now walks the two paths segment by segment and returns at the
first position where their specificity differs, ranked static (`packages/theo/src/server/scan/scan.ts:179`)
before dynamic before catch-all by `segmentSpecificity`
(`packages/theo/src/server/scan/scan.ts:183`). The exact pair the old file used as its example is now a
regression test: `tests/unit/server-route-precedence.test.ts:43` asserts `/api/users/settings` reaches
`/api/users/:id`, and `tests/unit/server-route-precedence.test.ts:55` asserts the ordering itself.

Two details worth carrying forward, because they are easy to undo:

* **The final tiebreak is a code-unit comparison, not `localeCompare`**
  (`packages/theo/src/server/scan/scan.ts:225`). Collation is locale-dependent, so `localeCompare` would let
  the same route table order differently under a different `LANG`. The sibling page scanner made the same
  change for the same reason (`packages/theo/src/router/scan.ts:142`).
* **Only the segments the two paths share are ranked** (`packages/theo/src/server/scan/scan.ts:218`). Past
  that point one path is a strict prefix of the other and the two cannot match the same URL, so there is
  nothing to decide — only a stable order to pick.

The order IS the contract, because `matchRoute` returns on the first pattern that matches
(`packages/theo/src/server/scan/match.ts:40`). Anything that reorders the list changes dispatch.

---

## The order to close it

Each step is independently shippable, and each earns something the next one needs. Step 1 of the
2026-08-19 edition — per-segment precedence for server routes — shipped on 2026-08-20 and has been removed
from this list rather than left standing as work.

1. **`template`.** One reserved name, one wrapper, no URL effect, no hard-load path to design. Removes the
   keyed-layout workaround. It is an addition to `ROUTE_FILE_NAMES`
   (`packages/theo/src/router/types.ts:5`), the regex beside it
   (`packages/theo/src/router/types.ts:11`) and one branch in `setRouteFile`
   (`packages/theo/src/router/scan.ts:16`) — the smallest convention this surface can add.
2. **Optional catch-all.** The scanner already refuses it by name
   (`packages/theo/src/router/scan.ts:69`), so the migration is additive and nothing breaks. Deletes
   duplicated index pages.
3. **`forbidden` / `unauthorized`.** Reserved names plus status mapping. No router surgery. Now cheaper
   than it was: since 2026-08-20 every server route declares who may call it
   (`packages/theo/src/server/scan/errors.ts:98`), so "authorised but forbidden" is a state the framework
   can already distinguish rather than one an application has to invent.
4. **Give the page scanner typed refusals**, matching the server side. `RouterConventionError`
   (`packages/theo/src/server/scan/errors.ts:39`) and `MissingRoutePolicyError`
   (`packages/theo/src/server/scan/errors.ts:98`) can be caught, asserted and counted; the page scanner's
   two `throw new Error` calls (`packages/theo/src/router/scan.ts:69` and
   `packages/theo/src/router/scan.ts:88`) can only be string-matched. Small, and it makes every later step
   testable in the same way.
5. **Named slots + `default`.** The large one. Requires: slot folders excluded from the URL, layout props
   per slot, per-slot boundaries, per-slot state across soft navigation, and a build error when `default`
   is absent. Do not ship slots without `default` — the failure appears only on refresh, only in
   production.
6. **Intercepting routes.** Depends on the router distinguishing soft from hard navigation, so it lands
   after slots.
7. **Segment config.** Best introduced alongside the caching and prefetching work, since most of its knobs
   are theirs. It also needs the page scanner to read a route file's source for the first time, which the
   server scanner already does (`packages/theo/src/server/scan/scan.ts:152`) and is the piece to reuse.

Before each step, answer the seven extension questions in `SKILL.md`. Steps 5 and 6 are the ones where
question 6 — hard load versus soft navigation — decides the design rather than decorating it.
