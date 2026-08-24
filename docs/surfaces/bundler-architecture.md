# The build layer in this framework: what exists, and where it can be better than the field

Re-measured 2026-08-20 against `packages/theo/src/vite-plugin/` (29 modules plus an
`openapi-emit/` directory), `packages/theo/src/router/generate.ts`,
`packages/theo/src/server/scan/`, `packages/theo/tsup.config.ts` and `.github/workflows/ci.yml`.
Re-measure before trusting.

Where the 2026-08-19 version of this file was wrong, the correction says what it used to claim.

## Contents

1. [What exists](#what-exists)
2. [What is strong](#what-is-strong)
3. [Parity gaps](#parity-gaps)
4. [Where this framework can be better](#where-this-framework-can-be-better)
5. [The order](#the-order)

---

## What exists

| Capability | Shape |
|---|---|
| A plugin over an established bundler | Twenty-nine modules: virtual modules, typed-client emission, SSR middleware, HMR, integrations, head hoisting, WebSocket upgrade |
| Virtual modules | Route manifest, actions, agents, typed clients — resolved and served through the plugin (`packages/theo/src/vite-plugin/virtual-modules-hook.ts:52`) |
| Server-route HMR | Watch, 50 ms debounce, invalidate the SSR module cache (`packages/theo/src/vite-plugin/server-routes-hmr.ts:47`, `packages/theo/src/vite-plugin/server-routes-hmr.ts:66`) |
| Client route-manifest invalidation | Adding or removing an `app/` route file invalidates the manifest module and full-reloads (`packages/theo/src/vite-plugin/configure-server-hook.ts:155`) |
| Code splitting | Pages are lazy; layouts, error, loading and not-found stay static (`packages/theo/src/router/generate.ts:129`) |
| A preload map | Generated per route path, keyed to match the router's resolution (`packages/theo/src/router/generate.ts:144`) |
| **Deterministic scanner output** | Build-time scanners order by UTF-16 code unit, not by locale collation (`packages/theo/src/server/_internal/compare-by-code-unit.ts:22`) |
| Package builds | A separate bundler for library output, with declaration emission and multiple entry points (`packages/theo/tsup.config.ts:48`) |

### Deterministic ordering — the row that is new since 2026-08-19

The previous version listed determinism only as a gap ("Nothing asserts that two builds produce
identical output") and said nothing about *why* two builds might differ. Since then a named cause
was found and removed: `localeCompare` uses the default collator, which Node derives from
`LC_ALL`/`LANG`, so the same tree sorted differently on two machines and the emitted manifest
differed with it (`packages/theo/src/server/_internal/compare-by-code-unit.ts:5`). Where the order
being emitted is an execution order — middleware — it decided which middleware ran first.

Six build-time sorts now compare by code unit:

| Scanner | Site |
|---|---|
| Client route tree | `packages/theo/src/router/scan.ts:142` |
| Server route table (tiebreak after specificity) | `packages/theo/src/server/scan/scan.ts:215` |
| Middleware files | `packages/theo/src/server/scan/middleware-scan.ts:39` |
| Detected HTTP methods | `packages/theo/src/server/scan/detect-http-methods.ts:96` |
| Action files | `packages/theo/src/server/scan/action-scan.ts:182` |
| Cron and job definitions | `packages/theo/src/server/cron/cron-scan.ts:127`, `packages/theo/src/server/jobs/job-scan.ts:97` |

`localeCompare` survives in three places, and only one of them is arguably build-shaped:
`packages/theo/src/client/react-query-adapter.ts:27` sorts object keys while building a query key.
The other two are presentation (`packages/theo/src/devtools/state/actions-row-state.ts:35`) and the
comparator's own docstring. **Not measured:** whether a locale difference between the server and
the browser can make the two sides derive different query keys for the same input. It is the shape
of the defect that was fixed elsewhere, and it was not exercised here.

This does not make the build reproducible. It removes one measured cause of irreproducibility.
Nothing yet asserts the output is identical across two runs — see § Parity gaps.

---

## What is strong

Three decisions worth protecting:

1. **Only pages are lazy.** The chrome a transition renders into — layout, error boundary, loading
   fallback — is always present, so a navigation never waits for the pieces it needs most
   (`packages/theo/src/router/generate.ts:105`). That is a deliberate splitting decision, and it is
   the right one. The preload map then re-imports the matched page before `hydrateRoot`, so
   `React.lazy` resolves from cache and no fallback flashes during hydration
   (`packages/theo/src/router/generate.ts:139`).
2. **Virtual modules are used properly.** Generated route manifests and typed clients participate
   in the graph rather than being written to disk and imported, which keeps generated artefacts out
   of the source tree and out of version control.
3. **Building on an established bundler.** Writing a bundler is a multi-year commitment with no
   user-visible payoff; extending one through a plugin is the right trade for a framework of this
   size, and it makes the plugin surface — not the bundler — the thing to get right.

---

## Parity gaps

| Missing | Consequence |
|---|---|
| Persistent build cache across processes | Every CI build is cold; the DTS build for ~24 entrypoints OOMs the runner's default worker heap, which CI works around by raising it to 8 GB workflow-wide (`.github/workflows/ci.yml:20`) |
| Graph queryability | No answer to "why is this module here?" without deleting and rebuilding. `dependency-cruiser` runs over `packages/theo/src` for boundary rules (the `check:deps` script, configured by `./.dependency-cruiser.cjs:57`), not as a queryable graph |
| Bundle budgets | Nothing fails when a route's first load grows. The one budget in the repository is a 30 K figure argued in a source comment and enforced by human judgement (`packages/http/src/index.ts:28`); no CI job measures it |
| Duplicate-package detection | Two copies of a stateful package are found by their symptoms |
| Determinism verification | Nothing asserts that two builds produce identical output. One cause of divergence was removed (see § What exists); the property itself is still unmeasured |
| Virtual module input declarations | Partially wired and unaudited: the route manifest is invalidated on `add` and `unlink` of an app route file (`packages/theo/src/vite-plugin/configure-server-hook.ts:160`) and no generated module declares the full set of real inputs that should invalidate it |
| Chunking strategy beyond page lazy-loading | No shared-chunk rule, no vendor split policy |
| Dev/production module-set comparison | Tree-shaking surprises surface in production |

**Corrected from 2026-08-19.** That version said flatly that nothing was known about virtual-module
invalidation. One case is wired and can be cited; the audit across all generated modules is what
remains. The DTS-OOM claim held on re-measurement and now has its evidence attached.

---

## Where this framework can be better

The incumbents in this space compete on raw build speed, and speed is where an established bundler
already wins. The unclaimed ground is elsewhere: **a build that can explain itself, and that fails
when it gets worse.** Four positions, all of which build on the route manifest this framework
already generates.

### 1. `theokit graph` — the question every performance conversation needs

The framework generates the route manifest, so it knows the entries. Exposing the graph as a
command answers, without a rebuild:

```text
$ theokit graph why date-lib
$ theokit graph chunks
$ theokit graph route /dashboard      what a first paint of this route costs
$ theokit graph diff HEAD~1           what this change added, and which import pulled it in
```

The fourth is the one that changes behaviour: a size diff per pull request, attributed to an
import, turns bundle growth into a reviewable decision. No mainstream framework ships this; bundle
analysis is a separate tool nobody runs twice.

### 2. Budgets as build gates, per route

The framework knows the route table, so a budget can be **per route** rather than global — the only
granularity that means anything to a user, since nobody loads the whole application. Exceeding it
fails the build, with the graph diff attached.

This repository already has the argument for budgets and none of the machinery: three modules were
kept out of a barrel because adding them pushed a bundle from 28.9 K to 31.1 K against a 30 K
budget (`packages/http/src/index.ts:28`). That decision was made by a person reading a number by
hand, and it holds only until the next person does not.

### 3. Duplicate-package detection for stateful packages

A declared list of packages that must appear exactly once, verified against the graph at build
time. The symptoms of a duplicated stateful package — a context provider not seen by its consumer,
two client instances, a failing `instanceof` — are among the most confusing failures in the
ecosystem, and they are trivially detectable at the point they are introduced.

### 4. Determinism as a test

Two builds, compared byte for byte, in CI. It is a handful of lines, it protects every claim about
caching, and it catches an impure plugin the day it lands rather than during an unrelated incident.
Nobody ships it — and this repository has now paid twice for its absence, in two issues about
scanners that emitted a different manifest per machine
(`packages/theo/src/server/_internal/compare-by-code-unit.ts:11`). Both were found by reasoning
about the code, not by a check. A byte-for-byte comparison would have found them on the first run.

---

## The order

1. **Determinism check in CI.** Cheapest item here, and it protects everything that follows. Build
   twice, compare. The ordering fixes make it plausible that it would pass today, which is exactly
   the moment to add it — a check introduced while red gets skipped.
2. **Graph output as a build artefact**: modules, chunks, sizes, and the import path per module.
   Even as JSON with no command around it, this is the input to items 3 and 4.
3. **Per-route budgets**, failing the build, with the graph diff in the failure message. Start by
   mechanising the 30 K figure that is already being enforced by hand.
4. **`theokit graph` commands** over the artefact from item 2 — `why`, `chunks`, `route`, `diff`.
5. **Duplicate detection** for a declared list of packages that must be singletons.
6. **Virtual module input declarations**, audited: every generated module lists the real inputs that
   invalidate it, and a test asserts that adding a route file invalidates the manifest. One such
   wiring exists; nothing states the set, and nothing tests it.
7. **A persistent build cache** for the package builds, keyed completely — the DTS build is the
   current pain, and the 8 GB heap in CI is the receipt.
8. **Dev/production module-set comparison** as a diagnostic, for tree-shaking surprises.

Items 1 to 4 are a small programme with an outsized effect: they make the build explain itself and
refuse to get worse quietly, which is the part the incumbents left to external tooling that teams
run once.
