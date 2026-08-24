# What this framework ships at the boundary, and the order to close the gap

Re-measured 2026-08-20 against `packages/theo/src/server/security/`, `packages/theo/src/server/http/`,
`packages/theo/src/server/web-handler.ts`, `packages/theo/src/core/contracts/route-policy.ts`,
`packages/theo/src/server/scan/`, `packages/theo/src/server/rate-limit/` and
`packages/http/src/action-encryption.ts`. Re-measure before trusting.

Every row below is read from the code and cites `file:line`. Where the 2026-08-19 version of this
file was wrong, the correction says so and says what it used to claim — a file that quietly deletes
its own error teaches nobody why it happened.

## Contents

1. [What exists](#what-exists)
2. [What is strong](#what-is-strong)
3. [What is missing](#what-is-missing)
4. [The order to close it](#the-order-to-close-it)

---

## What exists

| Capability | Shape | Reachable from production? |
|---|---|---|
| CSRF gate | Custom header `X-Theo-Action` plus an `Origin`/`Host` match — **not a token flow** (`packages/theo/src/server/security/csrf.ts:126`, `packages/theo/src/server/security/csrf.ts:131`) | Yes — Node executor, action executor, controller dispatch, Web executor |
| CSRF on by default at the Web boundary | Absence of the option enforces; only an explicit `'off'` disables (`packages/theo/src/server/web-handler.ts:514`), applied on both the no-hooks and the hook path (`packages/theo/src/server/web-handler.ts:560`, `packages/theo/src/server/web-handler.ts:622`) | Yes |
| Per-route CSRF opt-out | `csrf: false` honoured by the Web executor (`packages/theo/src/server/web-handler.ts:516`), the Node executor (`packages/theo/src/server/http/execute.ts:205`) and the action executor (`packages/theo/src/server/http/action-execute.ts:134`); declared with `.csrf(false)` on both builders (`packages/theo/src/server/define/route-builder.ts:116`, `packages/theo/src/server/define/action-builder.ts:79`) | Yes |
| Multi-header CSRF gate (Sec-Fetch-Site / Origin / Referer) | `evaluateCsrfMultiHeaderRequest` (`packages/theo/src/server/security/csrf-multi-header.ts:147`), published through the `theokit/server/security` barrel (`packages/theo/src/server/security/index.ts:4`); the `IncomingMessage` twin is gone | **Exported, never called.** No production caller in this repo |
| Wildcard origin allowlist | `isCsrfOriginAllowed` (`packages/theo/src/server/security/wildcard-origin.ts:58`) | Only through the multi-header gate above, so unreachable in practice |
| CSRF readiness endpoint and store | `/__theo/csrf-readiness` (`packages/theo/src/server/security/csrf-readiness-endpoint.ts:21`) | **Dev only** — mounted by the Vite plugin (`packages/theo/src/vite-plugin/api-middleware.ts:349`), never by `theo start` |
| CSRF warning dispatch | `dispatchCsrfWarn`, used by all three Node executors (`packages/theo/src/server/http/execute.ts:16`, `packages/theo/src/server/http/action-execute.ts:14`, `packages/theo/src/server/http/controller-dispatch.ts:11`) | Yes |
| Route access policy | `RouteConfig.policy`, evaluated by one function (`packages/theo/src/core/contracts/route-policy.ts:65`) from the Node executor (`packages/theo/src/server/http/execute.ts:268`), the Web executor (`packages/theo/src/server/web-handler.ts:260`) and `callProcedure` (`packages/theo/src/server/http/in-process-caller.ts:103`) | Yes, on all three transports |
| Record-level authorisation primitive | `requireOwner` (`packages/theo/src/core/contracts/route-policy.ts:86`) | **Written, not exported.** See § What is missing |
| Build-time refusal of an undeclared policy | `scanServerRoutes` throws `MissingRoutePolicyError` (`packages/theo/src/server/scan/scan.ts:110`), naming file, route and silent methods (`packages/theo/src/server/scan/errors.ts:98`) | Yes — every entry point reaches the scanner |
| Build-time refusal of a server-only import in the client bundle | `serverOnlyImportBoundary` throws `ServerOnlyImportError`, naming the module and the importing file (`packages/theo/src/vite-plugin/server-boundary.ts:201`) | Yes — `theoPluginAsync` returns it, so `theokit build` and `theokit dev` both carry it (`packages/theo/src/vite-plugin/index.ts:256`) |
| Security headers, including CSP with a per-request nonce | `buildSecurityHeaders` applied on every production request (`packages/theo/src/cli/commands/start/request-handler.ts:241`) and in dev (`packages/theo/src/vite-plugin/api-middleware.ts:374`) | Yes |
| CSP violation reporting | `handleCspReport` (`packages/theo/src/server/security/csp-report.ts:126`) | **Dev only** — mounted by the Vite plugin (`packages/theo/src/vite-plugin/api-middleware.ts:343`) |
| Rate limiting | Per-route rules, pluggable store, client-IP derivation behind a proxy (`packages/theo/src/server/rate-limit/client-ip.ts:53`) | Yes — built at production boot (`packages/theo/src/cli/commands/start/index.ts:123`) |
| Sessions | AES-GCM-256 (`packages/theo/src/server/auth/crypto.ts:43`), `httpOnly` (`packages/theo/src/server/auth/session.ts:143`), dual-key rotation, 32-character secret floor enforced by throw (`packages/theo/src/server/auth/session.ts:83`) | Yes |
| Input validation | One shared pipeline for all three channels, used by the HTTP path and by `callProcedure` (`packages/theo/src/server/http/validate-route-input.ts:43`) | Yes |
| Argument encryption | AES-GCM-256, random 96-bit IV per call (`packages/http/src/action-encryption.ts:52`) | **Exported as a subpath, never called** — the barrel comment says so in its own words (`packages/http/src/index.ts:26`) |

### Corrections to the 2026-08-19 version of this table

* It said CSRF defence was a **"token flow"**. There is no CSRF token in this codebase — a
  repository-wide search for one finds nothing. The gate is a custom header plus an origin match
  (`packages/theo/src/server/security/csrf.ts:126`). Reading "token flow" would lead someone to
  look for a token endpoint that does not exist, and to assume a defence stronger than the one
  shipped.
* It listed **argument encryption**, the **multi-header gate**, the **wildcard origin matcher**,
  the **readiness endpoint** and **CSP reporting** flatly under "what exists", with no distinction
  between a capability the framework runs and one it merely publishes. Three of those have no
  production caller at all and two run only under `theo dev`. That conflation is the single error
  that produced the wrong picture; the third column exists to stop it recurring.
* It did not mention `RouteConfig.policy` or the build-time policy gate, because neither existed
  when it was written. Both landed on 2026-08-20.
* It listed **server-only module markers** under "what is missing", saying importing a server module
  from a client entry is not a build error. That was true when measured and is not true now: the
  boundary landed on 2026-08-20 and the row moved up to the table above. It is recorded here rather
  than deleted, because the shape of what is left changed — the gap was "no boundary at all", and it
  is now "no tainting", which is a different and smaller thing (see § The order to close it, item 4).

---

## What is strong

1. **Validation is not optional, and it is one pipeline.** Route, action and tool builders take a
   schema, the handler receives the parsed value, and the HTTP executors and `callProcedure` share
   the same validator (`packages/theo/src/server/http/validate-route-input.ts:43`). The most common
   boundary failure — trusting the wire's shape — is structurally hard to commit here, and it
   cannot drift between transports because there is only one implementation to drift from.
2. **One access decision, evaluated on every transport.** `evaluateRoutePolicy` is called from all
   three executors (`packages/theo/src/server/http/execute.ts:268`,
   `packages/theo/src/server/web-handler.ts:260`,
   `packages/theo/src/server/http/in-process-caller.ts:103`) and the policy is handed a resolved
   subject rather than a header or a cookie (`packages/theo/src/core/contracts/route-policy.ts:18`).
   A terminal client and a browser therefore get the same answer for the same subject, which is
   the property most frameworks assert and do not have.
3. **Absence stopped meaning open.** A route file whose HTTP export declares no policy fails the
   build, by name (`packages/theo/src/server/scan/scan.ts:110`). The detector reads the TypeScript
   AST rather than a regex, and it deliberately refuses to walk a handler body or follow a
   re-export — it would rather fail a route that is protected elsewhere than pass one nobody
   protected (`packages/theo/src/server/scan/detect-route-policy.ts:23`).
4. **CSRF defaults to enforced at the Web boundary.** Omitting the option enforces the gate
   (`packages/theo/src/server/web-handler.ts:514`). This matters more than it sounds: that executor
   is what the Cloudflare, Bun and Deno adapters are built on, so a default of `'off'` was a
   control every adapter author had to remember.
5. **Opt-outs are explicit and per route.** `csrf: false` is a visible decision in a diff, which is
   what an exemption should be, and all three executors honour the same field.
6. **Client-IP derivation is a named module** (`packages/theo/src/server/rate-limit/client-ip.ts:53`),
   so the "trust the forwarding header" decision has one place to be right — the difference between
   a rate limiter and a rate limiter anyone can reset.
7. **Session secrets have a floor and support rotation**, both enforced by throw at construction
   (`packages/theo/src/server/auth/session.ts:83`). Both are unusual and both are load-bearing.

---

## What is missing

| Missing | Consequence | Evidence |
|---|---|---|
| **`requireOwner` has no door** | The build error tells the author to write `requireOwner(subject, ownerOf(params.id))` (`packages/theo/src/server/scan/errors.ts:123`), and no package entry point exports it. `core/contracts/index.ts` re-exports eleven other contracts and not this one (`packages/theo/src/core/contracts/index.ts:12`), and no `index.ts` in the tree names `route-policy.js`. The framework's answer to "may this subject touch this record" is currently unreachable from an application | measured 2026-08-20 |
| **Actions have no policy at all** | `RouteConfig.policy` covers routes. `ActionConfig` carries `input`, `accept`, `csrf` and `handler` and nothing else (`packages/theo/src/server/define/action-builder.ts:89`), and the action executor never calls `evaluateRoutePolicy`. The mutation surface most applications actually use is outside the guarantee ADR 0001 established | measured 2026-08-20 |
| **The build gate does not reach actions** | `assertEveryMethodDeclaresPolicy` runs over route files (`packages/theo/src/server/scan/scan.ts:100`); `action-scan.ts` has no equivalent. So "absence stopped meaning open" holds for routes and not for actions | measured 2026-08-20 |
| **A `RouteConfig` built in memory still bypasses the gate** | Deliberate and documented (`packages/theo/src/server/scan/scan.ts:94`) — the build gate reads the file system, and the runtime treats an undeclared policy as allowed (`packages/theo/src/core/contracts/route-policy.ts:69`). Correct as a migration choice; still a hole while the migration runs | measured 2026-08-20 |
| **Opaque action identifiers** | An exposed mutation is addressed by its source name in the URL (`packages/theo/src/vite-plugin/actions-virtual-module.ts:216`), with no rotation between builds. The `act-…` id nearby is a devtools telemetry id, not a wire identifier (`packages/theo/src/vite-plugin/actions-virtual-module.ts:202`) | measured 2026-08-20 |
| **Dead-code elimination of unused mutations** | A mutation nothing references still ships and stays reachable | measured 2026-08-20 |
| **Tainting** | No mechanism to make a value un-passable; disclosure is prevented by discipline only | measured 2026-08-20 |
| **A data-access-layer convention** | Field selection and record-level authorisation live wherever each caller put them | measured 2026-08-20 |
| **Payload minimisation guidance or tooling** | Nothing inspects what the hydration payload carries | measured 2026-08-20 |
| **CSP reporting and CSRF readiness in production** | Both are mounted by the Vite plugin only (`packages/theo/src/vite-plugin/api-middleware.ts:343`, `packages/theo/src/vite-plugin/api-middleware.ts:349`). A CSP that reports nothing in production is a CSP nobody can tighten | measured 2026-08-20 |
| **Bundle secret scanning** | The repository scans source and history with TruffleHog (`.github/workflows/secret-scan.yml:42`); no job builds the client output and scans it for the *values* of configured secrets | measured 2026-08-20 |

**Corrected from 2026-08-19.** That version listed *"Authorisation primitives beyond
authentication"* as missing, saying `requireAuth` narrows a session and there is no equivalent for
"may this subject touch this record". That is now half wrong and worth splitting rather than
deleting: the primitive was written, is evaluated on every transport, and is refused at build time
when absent — and it cannot be imported. The gap moved from *nothing exists* to *it exists and has
no door*, which is a much cheaper thing to close and a much easier thing to miss.

The two with the widest blast radius are the action surface and bundle secret scanning: the first
because the guarantee reads as complete and covers half the mutation surface, the second because
it fails silently and publishes something that cannot be recalled.

---

## The order to close it

1. **Export `requireOwner`, `evaluateRoutePolicy`, `RoutePolicy` and `RouteSubject`.** Hours of
   work. Until it lands, the build gate instructs every application author to call a function they
   cannot import, which is the worst possible state for a gate that fails builds — it is right, it
   is loud, and the remedy it names does not resolve.
2. **Give actions a policy, evaluated by the action executor.** Same field, same evaluator, same
   `evaluateRoutePolicy` call the three route paths already make. Then extend the scanner refusal to
   action files, so absence stops meaning open on the surface where most mutations live.
3. **Scan the built client bundle for secret values in CI.** Cheap, and the only item here that
   catches a disclosure before it ships. Point the same class of check at `dist` and search for the
   *values* of configured secrets, since build-time inlining removes their names.
4. ~~**Server-only markers.**~~ **Done 2026-08-20.** The client graph refuses `theokit/server`,
   every published `theokit/server/*` subpath, and every module under the project's `serverDir`,
   naming the module and the importing file
   (`packages/theo/src/vite-plugin/server-boundary.ts:201`). The one exception is
   `actions/schemas/**`, which the actions facade bundles on purpose. What remains open is narrower
   than the original item: the boundary refuses by module identity, not by taint, so a *value* read
   on the server and passed to a client component is still unguarded. Separately, the alias cascade
   that made the old failure read as `ENOTDIR` is still there and still breaks `theokit/client/core`
   (usetheokit/theokit#377) — the boundary hides it on the server side, it does not fix it.
5. **Mount CSP reporting in production.** The handler exists and is wired in dev only; a report-only
   CSP that reports to nobody in the environment that matters cannot be tightened into an enforcing
   one.
6. **Document and enforce a data-access-layer convention** per resource, with the subject as a
   required argument. Start with the resources that have more than one caller.
7. **Decide the fate of the multi-header gate and of argument encryption.** Both are published, both
   are unused, and both read as capabilities in every summary of this surface. Either wire the
   multi-header gate as an option on the Web executor and give action encryption a caller, or say in
   their own module headers that they are opt-in primitives with no framework consumer.
8. **Opaque, per-build action identifiers**, plus elimination of unreferenced mutations. Together
   they remove the reachability of everything nobody linked, and bound replay to a single build.
   Neither is authorisation — ship them with a note saying so, or they will be read as one.
9. **Payload inspection in the test suite.** Assert that a rendered page's serialised payload
   contains only the fields a route declares. This is the regression guard for over-fetching, and
   the only one that keeps working as the codebase grows.
10. **Tainting**, if and when the runtime supports it, applied inside the data-access layer from
    step 6.

Steps 1 and 2 are the ones that finish a guarantee already half-built, and they are cheap precisely
because the hard part — one evaluator on three transports — is done. Steps 3 and 4 are days of work
and remove whole classes.
