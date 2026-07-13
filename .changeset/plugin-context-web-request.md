---
"theokit": minor
---

Plugin hooks now receive a Web `Request` as `ctx.request` in every runtime (#119, ADR-0056). Previously the
Node server (`theokit dev` / `theokit start`) passed plugin `onRequest` / `preHandler` / `onResponse` /
`onError` hooks a Node `IncomingMessage`, while the edge adapters passed a Web `Request` — so a hook reading
`ctx.request.headers.get(...)` worked on the edge but threw on Node (and vice versa for `.headers[...]`).
`PluginContext.request` is now typed `Request` and built once per request from the `IncomingMessage`
(headers/URL/method; the body is read by the handler via `ctx.body`). Sibling of the #117 route-handler fix.

**Migration (breaking type change):** a plugin hook that read `ctx.request` as a Node `IncomingMessage`
(`.socket`, `.rawHeaders`, `.on('data')`, `.headers[name]`) must switch to the Web `Request` API
(`ctx.request.headers.get(name)`, `ctx.request.url`, `ctx.request.method`). An audit of the first-party
plugins found no hooks affected.
