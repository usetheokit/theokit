# ADR-0057 — Decorator controllers reach parity with file-based `route()` in a theokit app

- **Status:** Accepted
- **Date:** 2026-07-13
- **Issue:** #122 (follow-ups: #123 production `start`, #124 request-body inference)
- **Plan:** `.claude/knowledge-base/plans/decorator-file-based-parity-plan.md`

## Context

`@theokit/http` shipped NestJS-style decorator controllers (`@Controller`/`@Get`/`@Post`/`@Body`/`@Param`/`@Query`), but they were only usable via the standalone `createDecoratorServer` (its own `node:http` listener). Inside a `theokit dev` app they did **not** serve and did **not** appear in the typed `@theo/client` — only file-based `route()` did. #122 closes that gap: a `@Controller` class under `server/controllers/*.controller.ts` is served and typed at parity with `route()`.

## Decision

Controllers are a **parallel path**, not a rewrite of the file-route pipeline. Four load-bearing decisions:

1. **Compile via a Vite swc transform, scoped to `controllers/**` (ADR-4 in-plan).** esbuild cannot emit parameter-decorator metadata; a new `enforce:'pre'` Vite plugin routes only `serverDir/controllers/**` through `@theokit/http`'s swc transform (`transformControllerSource`, extracted for reuse — Rule 9/G12). Every other file, including all file routes, compiles byte-for-byte as before.

2. **Serve via a route-miss fall-through in `api-middleware` (dev), reusing http's dispatch.** On a file-route miss, the dev server builds a controller dispatcher over `@theokit/http`'s `createDecoratorHandler` (extracted pure Web-Standard handler: match + `@Param` bind + `@Body` validation + Response build). File routes take precedence; controllers inherit the security-headers/CORS/rate-limit/plugin gates already run upstream, and CSRF is enforced with the same gate `executeRoute` uses (parity). Body-ful Web `Request` via `incomingMessageToWebRequest` (ADR-0028 R3a).

3. **NEVER touch `generateManifest` (ADR-5 in-plan).** `generateManifest`/`ManifestRoute` are consumed by 10+ callers including every deploy adapter. Controllers are additive and out of the manifest, so a routes-only app's manifest AND `.theokit/client.d.ts` stay byte-identical (regression-tested). This preserves the deploy-adapter contract with zero ripple.

4. **Type the client with response-inference only; request body is `unknown` (ADR-2 checkpoint).** The codegen emits `client.<ns>.<method>()` with the response inferred via `Awaited<ReturnType<InstanceType<typeof Ctrl>['method']>>` and `:id` params typed from the route pattern. A spike proved `@Body`/`@Query` request types are **not** recoverable from the class type — parameter decorators are erased runtime metadata, so `Parameters<...>[N]` is positional-only and cannot discriminate body/param/query. Body falls back to `unknown`; runtime `@Body` Zod validation is unaffected. Full request-type inference is deferred to #124.

## Consequences

- **Positive:** decorator authors get dev serving + typed-client + response autocomplete with one file, at parity with `route()`; zero regression to file routes / manifest / deploy adapters; the swc + dispatch logic lives once in `@theokit/http` (no duplication).
- **Negative / deferred:** production `theokit start` does not yet serve controllers (they are not in the manifest and prod has no swc transform — needs build-time compilation; #123). Request `@Body`/`@Query` autocomplete is `unknown` (#124). A controller that shares a namespace+verb with a file route is skipped in the client with a warning (file route wins).
- **Rejected alternatives:** (a) emit controller K8s/manifest entries — breaks ADR-5 adapter contract; (b) re-implement match/bind/validate in theo — duplicates `@theokit/http` (Rule 9); (c) Zod-schema→TS-type emission for the body — brittle for advanced schemas, deferred to #124.

## Verification

Full `tests/` green (4065+ theo, 399 http); `tsc` clean; `eslint --max-warnings=0`. New coverage: swc-transform unit, controller-dispatch integration, client-emit unit + byte-identity, response-inference type-test, and an end-to-end parity test (same controller served through the real `api-middleware` AND typed in the client).
