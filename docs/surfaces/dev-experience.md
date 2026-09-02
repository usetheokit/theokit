# What this framework's dev loop provides, and the order to close the gap

**Measured 2026-08-20** against `packages/theo/src/devtools/`, `packages/theo/src/vite-plugin/`,
`packages/theo/src/cli/`, `packages/http/src/error-digest.ts` and `tests/lint/`. Re-measure before
trusting.

This surface was recorded as re-measuring clean on 2026-08-19. **It did not.** Re-reading it with one
question added — *does anything call this?* — found three of the eight rows in "what exists" claiming a
capability that no production code reaches. All three are corrected below, with what the old text said.
One capability was also added: observability is now wired in the dev loop, which it was not yesterday.

## Contents

1. [What exists](#what-exists)
2. [What is strong](#what-is-strong)
3. [What is missing](#what-is-missing)
4. [The order to close it](#the-order-to-close-it)

---

## What exists

| Capability | Shape | Where |
|---|---|---|
| Dev server with hot replacement | Provided by Vite, assembled by the `theo` plugin | `packages/theo/src/cli/commands/dev.ts:72`, plugin list at `packages/theo/src/vite-plugin/index.ts:241` |
| Server-route invalidation | Watches the routes directory on `add`, `change` and `unlink`, debounced 50 ms, invalidates the SSR module cache | `packages/theo/src/vite-plugin/server-routes-hmr.ts:78`, debounce at `packages/theo/src/vite-plugin/server-routes-hmr.ts:47`, invalidation at `packages/theo/src/vite-plugin/server-routes-hmr.ts:66` |
| Devtools | A first-party panel, injected in dev only, mounted into a shadow root | `packages/theo/src/vite-plugin/inject-devtools.ts:28`, mount at `packages/theo/src/devtools/dom/entry.tsx:32` |
| Named build-time refusals | Three typed scan errors, each naming the file and the fix | `packages/theo/src/server/scan/errors.ts:39`, `packages/theo/src/server/scan/errors.ts:98`, `packages/theo/src/server/scan/action-scan.ts:43` |
| **A route without a declared policy fails the scan** | **New on 2026-08-20** | `packages/theo/src/server/scan/scan.ts:110` |
| **Observability wired into the dev loop** | **New on 2026-08-20** — same plugin in `theo dev` and `theo start`, opt-in by config | `packages/theo/src/vite-plugin/config-resolve.ts:77`, `packages/theo/src/cli/commands/start/index.ts:94`, config key at `packages/theo/src/config/schema.ts:198` |
| Doctor command | Reports the resolved state of an installation without printing a secret | `packages/theo/src/cli/index.ts:183`, implementation at `packages/theo/src/cli/commands/doctor.ts:90` |
| Production server refuses to start without a build | Names the command to run | `packages/theo/src/cli/commands/start/index.ts:84` |
| Real security headers on the built server | Applied per response from `theo.config.ts` | `packages/theo/src/cli/commands/start/request-handler.ts:241`, config at `packages/theo/src/cli/commands/start/index.ts:155` |
| ~~Error digests~~ | **Removed — see the correction below** | — |
| ~~Stable warning codes~~ | **Downgraded — see the correction below** | — |
| ~~Startup configuration validation~~ | **Downgraded — see the correction below** | — |

### Three corrections to the 2026-08-19 edition

Each says what the old row claimed, and what is actually true.

**1. "Error digests — `digestError` produces a stable digest plus a structured envelope."** The function
exists (`packages/http/src/error-digest.ts:57`) and behaves as described, including stripping the stack in
production (`packages/http/src/error-digest.ts:64`). **It has no production caller.** Across
`packages/theo/src`, `packages/agents/src`, `packages/presenter/src` and `packages/http/src`, the only
references are the barrel re-export (`packages/http/src/index.ts:36`) and its own unit test. No response
carries a digest, no log line carries one, and nothing correlates the two. It is published code that never
runs outside a test — which is not a diagnostic, it is a diagnostic-shaped API.

This also invalidates the old closing step 4, "assert the digest linkage": there is no linkage to assert
until something calls the function.

**2. "Stable warning codes — metadata-only capabilities emit named codes rather than prose."** Overstated
by roughly an order of magnitude. **There is exactly one named warning-code constant in the framework:**
`CSRF_WARN_CODE = 'CSRF_STRICT_CUTOVER'` (`packages/theo/src/server/security/csrf.ts:78`), emitted in one
payload alongside a docs URL (`packages/theo/src/server/security/csrf.ts:228`). Everything else passes an
ad-hoc dotted string into `warnOnce` (`packages/theo/src/server/observability/logger.ts:126`) — seven
literal keys, all in the boot and shutdown paths
(`packages/theo/src/cli/commands/start/bootstrap-stages.ts:51`,
`packages/theo/src/cli/commands/start/manifest-loader.ts:47`,
`packages/theo/src/cli/commands/start/graceful-shutdown.ts:35`) plus two interpolated ones
(`packages/theo/src/server/http/execute.ts:65`) — and `packages/theo/src/cache/revalidate.ts:65` defines a
second, unrelated `warnOnce` with its own keys. Nothing enumerates or constrains any of them.

The one genuinely enumerated code union in the codebase is `TheoErrorCode`
(`packages/theo/src/core/contracts/error-envelope.ts:37`), 21 members, emitted on the wire
(`packages/theo/src/core/contracts/server-error-to-envelope.ts:28`). Those are error codes for a client,
not warning codes for a developer, and the previous edition credited the second with the discipline of the
first.

**3. "Startup configuration validation — session secret length and placeholder detection fail at
construction."** Half true, and the false half is the one that matters. Length does fail — inside
`normalizeSecrets` (`packages/theo/src/server/auth/session.ts:83`), when an application constructs a
session manager, which is lazy and per-application rather than at boot. **Placeholder detection never
runs.** `assertProductionSecret` (`packages/theo/src/server/auth/session.ts:337`), which holds the
`CHANGE_ME|demo[-_]|placeholder` pattern (`packages/theo/src/server/auth/session.ts:335`) and the
production refusal (`packages/theo/src/server/auth/session.ts:349`), is referenced by exactly one file:
`tests/unit/assert-production-secret.test.ts:2`. Neither `theo dev`, nor `theo build`, nor `theo start`
calls it. A deploy carrying `CHANGE_ME_…` boots.

**Update 2026-09-02 — both halves are now closed, and the second half was not in the original
finding.** The paragraph above is left as written, because what it measured was true and the reason
it went unnoticed is the lesson. Two things changed since:

- `assertProductionSecret` is called by `resolveSecrets`
  (`packages/theo/src/server/auth/session.ts:106`), which both session constructors run, so the
  check is on the path an application actually takes rather than on one a developer must know to
  call (#429).
- Being called was not enough. The `CHANGE_ME|demo[-_]|placeholder` pattern accepted
  `changemexxxx…`, `dev-only-…-secret`, `test-secret000…` and forty identical characters — measured
  against `theokit@0.64.0`, all five booted in production — so the length floor was still the only
  condition that ever fired. The vocabulary now lives in `inspectSecret`
  (`packages/theo/src/server/auth/secret-strength.ts:71`) with a distinct-character floor and a
  repeated-block check beside it (#610).

A guard that is called and admits `aaaa…` is worse than the uncalled one this correction found: it
retires the question.

---

## What is strong

Four things here are ahead of the field and worth protecting. The list is shorter than the previous
edition's by one, because one entry was crediting a function nobody calls.

1. **Server-route invalidation is deliberate and documented.** The watcher takes `add`, `change` and
   `unlink` (`packages/theo/src/vite-plugin/server-routes-hmr.ts:78`) and the comment explains the exact
   subtlety: adding and removing files works through the per-request scan, and only *edited* files need
   explicit module invalidation (`packages/theo/src/vite-plugin/server-routes-hmr.ts:63`). Most frameworks
   discover this as a bug report.
2. **Build-time refusals name the fix, and they are typed.** `RouterConventionError`
   (`packages/theo/src/server/scan/errors.ts:39`), `MissingRoutePolicyError`
   (`packages/theo/src/server/scan/errors.ts:98`) and `ActionScanError`
   (`packages/theo/src/server/scan/action-scan.ts:43`) can be caught and asserted rather than
   string-matched, and the migration URLs are constants so message and documentation cannot drift
   (`packages/theo/src/server/scan/errors.ts:20`, `packages/theo/src/server/scan/errors.ts:71`). The
   policy refusal even prints the copy-pasteable fix
   (`packages/theo/src/server/scan/errors.ts:115`). This is the shape `error-messages.md` argues for, and
   it is the one row of the old file that measured stronger than claimed, not weaker.
3. **A doctor command that never prints a secret.** The credential line is built from a three-value union,
   `'present' | 'absent' | 'unreadable'` (`packages/agents/src/doctor/diagnose.ts:90`), which is the only
   thing the detail string can contain (`packages/theo/src/cli/commands/doctor.ts:50`). The type makes the
   leak unrepresentable rather than merely unlikely, and it is asserted
   (`tests/unit/doctor-command.test.ts:31`). Note what it does not cover: the session secret, the security
   headers, and whether a build exists.
4. **Observability opts in explicitly, including in dev.** The plugin is wired unconditionally in both
   `theo dev` (`packages/theo/src/vite-plugin/config-resolve.ts:77`) and `theo start`
   (`packages/theo/src/cli/commands/start/index.ts:94`), and the decision to run is made by config, not by
   `NODE_ENV`. The documented divergence is worth keeping: `NODE_ENV=development` alone deliberately does
   **not** count as asking, because the console adapter writes a second JSON shape to the same `stderr`
   the logger already uses (`packages/theo/src/server/observability-bootstrap.ts:16`). Telemetry nobody
   requested, interleaved with the log everybody reads, is a downgrade.

**Devtools, precisely.** The panel is genuinely wired, and the chain is worth recording because it looks
like an orphan from any single file: `transformIndexHtml`
(`packages/theo/src/vite-plugin/transform-html-hook.ts:36`) injects a script tag
(`packages/theo/src/vite-plugin/inject-devtools.ts:20`) whose virtual module imports
`theokit/devtools/entry` (`packages/theo/src/vite-plugin/virtual-modules-hook.ts:100`), aliased to the DOM
entry (`packages/theo/src/vite-plugin/config-hook.ts:109`), which mounts into a shadow root
(`packages/theo/src/devtools/dom/entry.tsx:32`). It is a no-op outside dev
(`packages/theo/src/vite-plugin/inject-devtools.ts:33`) and gated on a config key
(`packages/theo/src/config/schema.ts:209`). One caveat: the React exports `Devtools` and `DevtoolsInProd`
(`packages/theo/src/devtools/index.ts:23`) have only test callers — the production mount goes through
`dom/entry.tsx`, never through the barrel.

---

## What is missing

| Missing | Consequence |
|---|---|
| **The digest reaching anything** | See correction 1. Before the linkage can be asserted, `digestError` (`packages/http/src/error-digest.ts:57`) has to be called on the server error path — today it is called nowhere. |
| **A boot-time secret check** | See correction 3. `assertProductionSecret` (`packages/theo/src/server/auth/session.ts:367`) exists, is tested, and is invoked by no command. **Closed 2026-09-02:** it runs from `resolveSecrets` (`packages/theo/src/server/auth/session.ts:106`) on both session constructors, and the vocabulary it checks was widened (#429, #610). It is still per-application construction rather than a `theo start` boot step — an app that builds no session manager is still unchecked. |
| **A warning-code catalogue — and codes to put in it** | See correction 2. The catalogue is missing, but the more urgent half is that only one code exists (`packages/theo/src/server/security/csrf.ts:78`); the rest are ad-hoc strings. Cataloguing them first would document a convention nobody follows. |
| **A production-like local mode, in one command** | Narrower than the previous edition implied, and still real. `theo start` does serve the built output with the real security headers (`packages/theo/src/cli/commands/start/request-handler.ts:241`) and refuses without a build (`packages/theo/src/cli/commands/start/index.ts:84`) — but reaching it is two commands, and there is no `preview`: the CLI registers dev, build, start, generate, agent, mcp, routes, check, add, info, doctor, upgrade-readiness, openapi, docker and db, and nothing else (`packages/theo/src/cli/index.ts:18`). |
| **Parity between the dev and built security paths** | The dev SSR middleware applies the same headers but branches on `NODE_ENV` for the production variants (`packages/theo/src/vite-plugin/ssr-dev-middleware.ts:122`), and applies the nonce on a separate line (`packages/theo/src/vite-plugin/ssr-dev-middleware.ts:118`). Close is not the same, and this is the divergence behind the recent nonce and hydration defects. |
| **Reload announcements** | Three senders fire a full reload silently: `packages/theo/src/vite-plugin/server-routes-hmr.ts:69`, `packages/theo/src/vite-plugin/configure-server-hook.ts:156`, `packages/theo/src/vite-plugin/actions-virtual-module.ts:96`. The routes one cannot even say which file did it — the debounce drops the path before firing (`packages/theo/src/vite-plugin/server-routes-hmr.ts:75`). |
| **An error overlay owned by the framework** | The SSR dev path calls Vite's `ssrFixStacktrace` and falls back to CSR (`packages/theo/src/vite-plugin/ssr-dev-middleware.ts:172`). Errors surface in the bundler's overlay or the console, without route context. The only `Overlay` in this codebase is the devtools panel (`packages/theo/src/devtools/dom/Overlay.tsx:55`). |
| **Server-side sourcemaps** | The SSR build declares `ssr`, `outDir`, `emptyOutDir` and `rollupOptions` and no `sourcemap` (`packages/theo/src/adapters/node.ts:48`), so Vite's default `false` applies and an SSR stack trace points at transformed output. `sourcemap: true` exists only for the framework's own tsup build (`packages/theo/tsup.config.ts:49`). No test asserts a stack frame names a source file. |
| **Multi-instance local mode** | No `node:cluster`, no worker flag; `startCommand` takes only a port (`packages/theo/src/cli/index.ts:41`). In-memory caches and rate limiters are only ever exercised as one process. |
| **A loop measurement** | Nothing records save-to-visible. No timer anywhere around the watch → invalidate → reload path. The concept exists only as a manual metric in `docs/program/dx-benchmark.md`. |
| **Error-message linting** | `tests/lint/` holds seven gates — `tests/lint/config-paths-resolve.test.ts:1`, `tests/lint/devtools-out-of-client-bundle.test.ts:1`, `tests/lint/doc-citations-resolve.test.ts:1`, `tests/lint/no-ptbr.test.ts:1`, `tests/lint/reference-zone-not-tracked.test.ts:1`, `tests/lint/release-version-guard.test.ts:1`, `tests/lint/task-marker.test.ts:1` — and none constrains what an error message says. The closest, `no-ptbr`, constrains the language, not the phrasing. Nothing prevents the next error from naming internals instead of the mistake. |

---

## The order to close it

The previous edition's step 1 stands; the steps around it changed, because three of them were written on
the assumption that a diagnostic existed and only needed testing.

1. **Wire the two diagnostics that exist and never run.** `assertProductionSecret`
   (`packages/theo/src/server/auth/session.ts:337`) called from the `theo start` boot path, and
   `digestError` (`packages/http/src/error-digest.ts:57`) called on the server error path with the digest
   written to both the response and the log. Each is a handful of lines, each already has a test of its
   own behaviour, and until they land, two of this surface's advertised capabilities are advertising only.
   Do this before anything on the list is measured again — it is the cheapest correction of a claim this
   file made and could not support.
2. **One command for a production-like local run.** Build, serve the built output, real security headers
   including the CSP, real cache headers on assets — a `preview` alongside the fifteen commands already
   registered (`packages/theo/src/cli/index.ts:18`). `theo start` already does most of it
   (`packages/theo/src/cli/commands/start/request-handler.ts:241`); what is missing is that reaching it
   takes two steps and a developer checking a CSP fix will not take them. This is the divergence that
   produced the most recent defects in this codebase.
3. **Remove the `NODE_ENV` branch from the dev security path**, or make it explicit and switchable
   (`packages/theo/src/vite-plugin/ssr-dev-middleware.ts:122`). Step 2 gives a place to verify headers;
   this is what makes the two paths comparable rather than merely similar.
4. **Assert the digest linkage** — now a real test rather than an impossible one. Trigger a production
   error, take the digest from the response, find the same value in the log output. It only becomes
   writable after step 1.
5. **Announce every full reload with the file that forced it.** Small, and it removes the most
   disorienting event in the loop. The routes watcher needs the path carried through the debounce
   (`packages/theo/src/vite-plugin/server-routes-hmr.ts:75`) before it can name anything.
6. **Two-instance local mode**, as a flag on the command from step 2. The in-memory cache
   (`packages/theo/src/cache/in-memory-adapter.ts:24`) and the rate limiter are both single-process today;
   this is what makes their real behaviour visible.
7. **Verify server-side sourcemaps.** Enable `sourcemap` on the SSR build
   (`packages/theo/src/adapters/node.ts:48`) and add a test that throws inside a route handler and asserts
   the top frame names the source file. The enabling and the test are one change — enabling it without the
   test just moves the assumption.
8. **Give warnings codes, then catalogue them.** `CSRF_WARN_CODE`
   (`packages/theo/src/server/security/csrf.ts:78`) is the shape to copy — a constant, plus a docs URL, in
   the payload. Convert the nine `warnOnce` call sites to named constants first; the catalogue page is
   worth writing only once there is more than one code in it.
9. **Loop measurement in CI**, even coarse: time a component edit, a server edit and a stylesheet edit
   against a fixture application, and fail on a large regression.
10. **A framework-owned overlay** with route context, error kind and a copy-paste form, surviving a
    reload. It lands last because it is worth most once the digest from step 1 can appear in it.

Step 1 is new and takes an hour. Step 2 is worth more than the rest combined for this codebase
specifically, and it is a day of work. Steps 4 and 7 are each a single test that protects a diagnostic
path nobody exercises until it is urgently needed.
