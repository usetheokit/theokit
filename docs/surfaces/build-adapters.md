# The adapter system this framework ships, and the order to close the gap

**Measured 2026-08-20** against `packages/theo/src/adapters/` and the CLI that dispatches into it
(`packages/theo/src/cli/commands/build.ts`).

## Contents

1. [What exists](#what-exists)
2. [What is strong](#what-is-strong)
3. [What is missing](#what-is-missing)
4. [The order to close it](#the-order-to-close-it)
5. [Not measured](#not-measured)

---

## The `resolveAdapter` trap, recorded first

There are **two** exported symbols named `resolveAdapter` in this repository. A 2026-08-19 sweep
merged them into one line — *"`resolveAdapter` appears only in tests"* — and that reading came close
to deleting the dispatch every deploy target depends on. They are unrelated and were measured
separately:

| Symbol | Status | Evidence |
|---|---|---|
| **Deploy registry** `resolveAdapter(target)` | **Wired.** It is how `build --target` dispatches | declared `packages/theo/src/adapters/registry.ts:41`; called `packages/theo/src/cli/commands/build.ts:222-224` |
| **Observability** `resolveAdapter({ env, config })` | Orphaned on 2026-08-19; **wired on 2026-08-20** through a new bootstrap | declared `packages/theo/src/server/observability/adapter-registry.ts:26`; called `packages/theo/src/server/observability-bootstrap.ts:79`, whose own callers are `packages/theo/src/cli/commands/start/index.ts:94` and `packages/theo/src/vite-plugin/config-resolve.ts:77` |

Nothing about the observability one is evidence about the deploy one. Neither is dead code today,
and the deploy one never was.

---

## What exists

| Capability | Shape | Evidence |
|---|---|---|
| Nine targets | `node`, `vercel`, `cloudflare`, `netlify`, `bun`, `deno-deploy`, `aws-lambda`, `static`, `theo-cloud` | `packages/theo/src/adapters/types.ts:29-38` |
| Registry | A declarative `Record<BuildTarget, () => Promise<DeployAdapter>>` of lazy imports, so an unused adapter is never loaded | `packages/theo/src/adapters/registry.ts:25-34` |
| Contract | `DeployAdapter` — `name` plus `build(config, cwd, ctx)` returning `Promise<void>` | `packages/theo/src/adapters/types.ts:24-27` |
| Dependency inversion | The build context injects a Vite plugin factory, so adapters do not import the plugin layer | `packages/theo/src/adapters/types.ts:20-22`; injected at `packages/theo/src/cli/commands/build.ts:201-217`; consumed at `packages/theo/src/adapters/node.ts:24,36` |
| Target validation | A typed union plus a validated list, so an unknown target fails with a named error listing the valid ones | `packages/theo/src/adapters/types.ts:40`; `packages/theo/src/cli/commands/build.ts:65-69` |
| One build, eight entry emitters | Every target except `theo-cloud` delegates the actual build to `nodeAdapter.build` and then emits its own platform entry | `packages/theo/src/adapters/bun.ts:131`, `packages/theo/src/adapters/netlify.ts:165`, `packages/theo/src/adapters/aws-lambda.ts:192`, `packages/theo/src/adapters/deno-deploy.ts:97`, `packages/theo/src/adapters/static.ts:195`, and `packages/theo/src/adapters/cloudflare.ts:125` / `packages/theo/src/adapters/vercel.ts:136` forwarding `ctx` |
| Managed-platform boundary | The managed adapter validates a service manifest, logs the services and hands over a bundle; the platform emits its own orchestration format | `packages/theo/src/adapters/theo-cloud.ts:24-34` |
| One capability declared as data | `CRON_NA_TARGETS` names the three targets with no native cron, and the supported list is derived from it rather than restated | `packages/theo/src/cli/commands/build.ts:40,46` |

---

## What is strong

Two decisions here are ahead of most adapter systems and worth defending in review:

1. **The open boundary is drawn correctly.** The managed-platform adapter deliberately does not emit
   that platform's orchestration format — it validates and prepares. The reasoning is recorded in the
   adapter itself (`packages/theo/src/adapters/theo-cloud.ts:10-14`): an open framework should emit
   formats consumed by open or public systems, not a proprietary consumer's internals. This is the
   decision that keeps eight other targets first-class.
2. **The registry inverts the dependency.** Adapters receive the Vite plugin chain through a build
   context (`packages/theo/src/adapters/types.ts:20-22`) rather than importing the plugin layer, and
   `nodeAdapter` fails with a named error when the factory is absent
   (`packages/theo/src/adapters/node.ts:24-28`) rather than reaching around it.

The lazy registry is also worth keeping: nine adapters cost nothing at runtime because only the
selected one is imported (`packages/theo/src/adapters/registry.ts:25-34`).

A third, added on this measurement: **eight of the nine targets share one build.** The 2026-08-19
version said *"each adapter re-derives what to deploy from the build's directory layout, so every
adapter is coupled to that layout and a change to it breaks all nine"* — the coupling is real but
narrower than that. It is one `nodeAdapter.build` call plus per-target entry emission, so a layout
change breaks the entry emitters, not nine independent build implementations.

---

## What is missing

| Missing | Consequence | Evidence |
|---|---|---|
| **An output description** | `build()` returns `Promise<void>`. Nothing describes assets, entrypoints, routing rules or the capabilities the application uses, so nothing downstream can be computed from the build | `packages/theo/src/adapters/types.ts:26` |
| ~~**Streaming on any shimmed target**~~ **— closed 2026-08-20, and the row understated it** | The shim accumulated every chunk and built the `Response` only in `end()`. Measured through it before the fix: 659 bytes as **one chunk at millisecond 1123 of an 1123 ms run**, against 9 chunks with headers at 1 ms and the first at 121 ms after. What this row missed is that fixing the shim alone would have changed nothing: **all six** emitted handlers buffered a second time, because each awaited `executeRoute` before calling `toResponse()` and `executeRoute` does not return until it has drained the body. AWS Lambda is now **delisted** for streaming — its v2 result carries `body` as a string and streaming needs `awslambda.streamifyResponse`, which this adapter does not emit — and the delisting is audible three ways rather than silent: the build refuses by name on `ssrStreaming`, the emitted handler logs the route when it buffers a `text/event-stream`, and all nine targets must now declare whether they stream. **`node` is exercised end to end; the other five are correct in the emitted contract and unproven on the platform**, because no deploy exists in CI (usetheokit/theokit#382) | `packages/theo/src/adapters/web-shim.ts`, `packages/theo/src/server/http/execute.ts`, `tests/unit/web-shim-streaming.test.ts`, `tests/unit/adapter-streaming-contract.test.ts` |
| ~~**Security headers on any deployed response**~~ **— closed 2026-08-21** | `theokit start` applied the configured baseline to every response it wrote and **not one** of the six Web-standards adapters applied any, so a deployed page carried no CSP, no `X-Frame-Options`, no HSTS and no `nosniff` while the same page under `theokit start` carried all four. All six now inline `security.headers` as a build-time literal, call the same `buildSecurityHeaders` the local server calls, and apply the result at ONE choke point per entry — including both 404 branches, which is where a later edit would otherwise slip past. Two limits are stated rather than left to be discovered: the CSP carries **no nonce** except on Cloudflare with `ssrStreaming: true` (the only target that renders HTML per request and can put the same value on the script tag), and on four targets the **document** is served by a platform static host this build does not configure, so the headers reach `/api/*` and not the page (usetheokit/theokit#412). Unlike the streaming row, this one is exercised: `tests/unit/adapter-security-headers.test.ts` imports each emitted entry, drives a request through it, and reads the headers off the real `Response` | `packages/theo/src/adapters/security-headers.ts`, `tests/unit/adapter-security-headers.test.ts`, `tests/unit/adapter-entry-parses.test.ts` |
| **A capability matrix per target** | See the correction below — one capability is declared, the rest are folklore | `packages/theo/src/cli/commands/build.ts:40` |
| **A capabilities field from the build** | Nothing to compare a target against, so a build-time refusal cannot be computed | absent |
| **Build-time refusals** | The one capability that *is* declared produces a warning and a skip, not a failure: crons declared against `bun`, `netlify` or `static` are silently dropped from a build that exits zero | `packages/theo/src/cli/commands/build.ts:248-253` |
| **Route → entrypoint mapping** | Everything routes to one entry; no per-route placement or per-route limits | absent |
| **Lifetimes on prerendered output** | Not applicable until prerendering exists; required the day it does | absent |
| **Description versioning** | Adapter and framework must move in lockstep | absent |
| **Smoke tests per target against built output** | The `package-validation` job runs publint, ATTW and `tests/smoke/`, which contains three files — changeset config, CI workflow shape and import validation. No target's output is executed against a request | `.github/workflows/ci.yml:194-209` |
| **Mid-deploy chunk recovery** | A client holding the previous document has no recovery path when a chunk 404s. No dynamic-import retry exists anywhere in `packages/theo/src` | absent |
| **Documented build-time variable set** | `.env` is loaded into the process at build start and nothing states which variables become part of the artefact's identity | `packages/theo/src/cli/commands/build.ts:53` |

### Correction: the capability matrix is not empty

The 2026-08-19 entry read *"Nothing declares that a target lacks websockets, post-response work or
streaming."* That is wrong on the first clause and imprecise on the rest:

* **Cron support IS declared as data**, and correctly: `CRON_NA_TARGETS` names the three targets
  without native cron, and the supported list is *derived* from it, with a comment recording that a
  hand-written second list already went stale once and told users three working targets were
  unsupported (`packages/theo/src/cli/commands/build.ts:40-46`). That is a capability declaration
  done right — the only one.
* **WebSocket support is implicit, not declared.** Three adapters import a WS bridge — bun
  (`packages/theo/src/adapters/bun.ts:54`), cloudflare
  (`packages/theo/src/adapters/cloudflare.ts:45`), deno-deploy
  (`packages/theo/src/adapters/deno-deploy.ts:35`). Nothing states this as a fact about the target; it is inferable only by
  reading six adapters and noticing which three import `ws-shim`.
* **Streaming is not declared and is not supported** on the six shimmed targets, for the reason in
  the table above.

So the correct statement is: one capability is declared as data and produces a warning; two more are
real and are folklore. The programme below is unchanged, but it starts from one worked example rather
than from zero.

### Correction: adapter tests do not test what the adapter produces

The 2026-08-19 entry said the package-validation job *"checks packaging, not that each target's
output serves a request"* — true, and the omission is wider. Adapters emit their platform entry as
generated source strings (`packages/theo/src/adapters/bun.ts:52`), and the per-target unit tests
assert `toContain` / `toMatch` over those strings (`tests/unit/bun-adapter.test.ts:28,33,39`). That
is the same assertion shape the ROADMAP names as what let usetheokit/theokit#344 ship. Nothing runs a
generated entry against a `Request`.

---

## The order to close it

1. **Streaming through the Web shim.** Promoted to first: it is the concrete blocker M14's first
   criterion grades, it affects six of nine targets, and it is a defect in shipped code rather than a
   missing feature. `createWebShim` must resolve its `Response` with a `ReadableStream` fed by
   `res.write` instead of concatenating at `end()`
   (`packages/theo/src/adapters/web-shim.ts:190-210`).
2. **Client-side chunk-load recovery.** Independent of everything else on this list, small, and it
   removes the most common "broke right after deploy" report. Catch a failed dynamic import, reload
   once, guard against a loop.
3. **An output description.** Have `build()` return a described set of outputs — assets with their
   content addressing, entrypoints with the routes they serve, routing rules with priorities, and
   metadata including the capabilities the application uses. Start by having adapters *emit* it
   alongside what they already do, so nothing breaks while the description proves itself.
4. **A capability matrix per adapter**, as data, extending the shape `CRON_NA_TARGETS` already
   demonstrates (`packages/theo/src/cli/commands/build.ts:40-46`): declare the negative set, derive
   the positive one, never restate. Nine small tables, and websockets and streaming are the two
   entries that already have answers.
5. **Build-time refusals**, comparing 3 against 4. This is the payoff: an application using
   websockets against a target without them fails the build with a named capability and a list of
   targets that do support it. It also converts the existing cron warning
   (`packages/theo/src/cli/commands/build.ts:248-253`) into a decision the developer makes rather
   than a line they scroll past.
6. **Per-target smoke tests** that run the built output and assert a served request. Without these, a
   target can rot silently — nine targets is more surface than review can cover, and the current
   tests assert the text of a generated entry rather than its behaviour.
7. **Description versioning**, once adapters consume the description rather than the directory
   layout.
8. **Route → entrypoint mapping and prerendered lifetimes**, alongside the rendering and caching work
   that produces them.
9. **Document the build-time variable set** and assert that a cold build and a cached build produce
   identical output — the same determinism property usetheokit/theokit#346 tracks for the client
   bundle.

Steps 3 through 5 are one programme and should be planned together: the description exists to make
the refusal computable, and the refusal is what makes nine targets a feature rather than nine ways to
find out in production.

---

## Not measured

* **Whether `static` produces deployable output.** It delegates to `nodeAdapter.build`
  (`packages/theo/src/adapters/static.ts:195`) like the rest, but the prerender half of a static
  target was not traced and no claim about it is made here.
* **What each generated entry does at runtime.** The entries are emitted as strings and were read as
  text. Whether a given target's entry actually serves a request was not executed — which is
  precisely the gap item 6 exists to close, so it is stated rather than assumed away.
* **The `ws-shim` bridges.** Presence and importers were measured
  (`packages/theo/src/adapters/ws-shim.ts`); whether a WebSocket upgrade completes on bun, cloudflare
  or deno-deploy was not.
