# ADR 0056 — Plugin hook context exposes a Web `Request` in every runtime

**Status:** Accepted (2026-07-13). Closes #119. Sibling of the #117 fix (route handlers get a Web `Request`
in the Node path, `theokit@0.36.1`).

## Context

The framework runs plugin hooks (`onRequest` / `preHandler` / `onResponse` / `onError`) through two
runners with two context shapes:

- **Node runner** (`plugins/plugin-runner.ts`, driven by `http/execute.ts` + `http/action-execute.ts` +
  `vite-plugin/api-middleware.ts` on `theokit dev` / `theokit start`): `PluginContext.request` was typed —
  and passed — as a Node `IncomingMessage` (`plugin-types.ts`).
- **Web runner** (`plugins/web-plugin-runner.ts`, driven by the edge adapters — Vercel / Cloudflare / Bun /
  Deno): `WebPluginContext.request` is a Web `Request`.

A single registered hook fn is stored untyped and cast to both shapes per runner (`plugin-runner.ts`
`fn as OnRequestHook`). So the *same* hook received an `IncomingMessage` on Node and a `Request` on the
edge. A hook reading `ctx.request.headers.get('authorization')` (Web-standard) worked on the edge but threw
`headers.get is not a function` on the Node dev/start server; one reading `ctx.request.headers[...]`
(Node-style) worked on Node but misbehaved on the edge. **Plugins were not portable across runtimes** — the
same root as #117 (the Node path leaking `IncomingMessage` where the rest of `server/` standardizes on Web
`Request`), one layer up (plugin hooks instead of route handlers).

Audit finding recorded on #117/#119: `action-execute.ts` does **not** have the #117 *handler* leak (an
action's handler ctx is `{ input, ctx }` — no `request`). Its `request: req` was the plugin context, so it
is covered by this ADR, not by a separate handler fix.

## Decision

**D1 — `PluginContext.request` is a Web `Request`, unified with `WebPluginContext.request`.** The Node
runners build the Web `Request` from the `IncomingMessage` via the #117 converter
`incomingMessageToHandlerRequest(req)` (`http/node-request.ts`) — method + absolute URL + headers — and pass
it to every hook. Built **once per request** and shared across all `buildPluginCtx` calls and (in
`execute.ts`) the route handler invocation, so a request produces exactly one Web `Request`.

**D2 — No request body on the Node plugin context.** `onRequest` / `preHandler` fire before the body is
parsed; the handler reads the body via `ctx.body`. The plugin request carries headers/URL/method only
(the Node stream is drained by `parseQueryAndBody`). This is the honest, safe subset — it makes
`request.headers.get()` / `.url` / `.method` portable, which is the reported gap, without the fragility of
draining the body stream inside a hook.

**D3 — `response` stays runtime-specific.** `PluginContext.response` remains a Node `ServerResponse`;
`WebPluginContext` keeps `responseHeaders` / `response?`. Unifying the *response* surface is a larger,
separate change (out of scope) — and `response` is `undefined` during `onRequest` / `preHandler` anyway.

**D4 — The app `createContext(req, res)` factory is NOT changed.** Its `ContextFactory` type is honestly
`{ request: IncomingMessage, response: ServerResponse }` (`middleware-runner.ts`) — the type matches the
runtime, so there is no hidden mismatch to fix. A future consistency pass may revisit it, but it is not a
#117/#119-class leak.

## Consequences

- **Breaking type change** for plugin authors who typed a hook against `PluginContext.request` as an
  `IncomingMessage` (e.g. reading `.socket`, `.rawHeaders`, `.on('data')`). Shipped as a **minor** bump
  (0.x semver-zero). Audit of the first-party `../theokit-plugins` (11 packages) + framework internals
  found **zero** hooks reading `ctx.request` in a Node-specific way, so real-world breakage is expected to
  be nil; the type change is the observable delta.
- Plugins are now portable: a hook written once runs identically on `theokit dev` / `start` and on the edge
  adapters for the header/URL/method surface.

## Alternatives considered

- **Keep two shapes, document the non-portability.** Rejected — it leaves a runtime footgun (works in dev,
  throws in prod-edge or vice versa) that contradicts ADR-0028 R3a's "all of `server/` flows through Web
  `Request`/`Response`".
- **Full-body Web Request for hooks** (`incomingMessageToWebRequest`). Rejected for the Node plugin context:
  `buildPluginCtx` is called up to 4× per request, and re-wrapping the same Node stream (`Readable.toWeb`)
  multiple times is unsafe; hooks reading the body would also consume it before the handler. Headers-only,
  built once, is the safe subset that closes the reported gap.

## References

- #119 (this), #117 (route-handler sibling), ADR-0028 R3a (Node adapter is the only IncomingMessage↔Request
  conversion point), `http/node-request.ts` (`incomingMessageToHandlerRequest`), `plugin-types.ts`
  (`PluginContext` / `WebPluginContext`).
