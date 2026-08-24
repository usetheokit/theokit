# What this framework's pipeline does today, and the order to close the gap

Re-measured 2026-08-20 against `packages/theo/src/router/entry-server.ts`,
`packages/theo/src/cli/commands/start/request-handler.ts`,
`packages/theo/src/cli/commands/start/ssr-setup.ts`,
`packages/theo/src/vite-plugin/ssr-dev-middleware.ts`,
`packages/theo/src/vite-plugin/hoist-head-tags.ts` and `packages/theo/src/adapters/cloudflare.ts`.
Re-measure before trusting.

The 2026-08-19 version of this file described a pipeline with **no** streaming on Node. That is no
longer true, and where a claim has been corrected the correction says what it used to say.

## Contents

1. [Three renderers, three behaviours](#three-renderers-three-behaviours)
2. [What already works](#what-already-works)
3. [What is missing](#what-is-missing)
4. [The order to close it](#the-order-to-close-it)

---

## Three renderers, three behaviours

`generateEntryServer` emits a streaming entry or a single-shot one depending on
`ssrStreaming` (`packages/theo/src/router/entry-server.ts:19`), and the streaming variant also
keeps a buffered `render` for backward compatibility
(`packages/theo/src/router/entry-server.ts:338`). The config default is `false`
(`packages/theo/src/config/schema.ts:142`).

| Entry | API | Consumer | Actually streams | Serves a full document |
|---|---|---|---|---|
| `render(url, options)` | `renderToPipeableStream` on `onShellReady` (`packages/theo/src/router/entry-server.ts:139`) | Accumulates into a `PassThrough` and resolves a string | **No** | Yes — the caller assembles head, body, hydration script and tail (`packages/theo/src/cli/commands/start/request-handler.ts:141`) |
| `renderStreaming(url, response, options)` — Node, opt-in | `renderToPipeableStream` piped into the live `ServerResponse` (`packages/theo/src/router/entry-server.ts:307`) | Writes chunks as they arrive | **Yes** | Yes — head first (`packages/theo/src/router/entry-server.ts:318`), hydration script and tail on `end` (`packages/theo/src/router/entry-server.ts:308`) |
| `renderStreamingWeb(request, options)` — edge | `renderToReadableStream` (`packages/theo/src/router/entry-server.ts:247`) | Returns a `Response` wrapping `__theoDocumentStream` (`packages/theo/src/router/entry-server.ts:252`) | **Yes** | **Only if the caller passes `htmlHead`/`htmlTail` — and its one production caller does not.** See below |

**Corrected.** The previous version said the Node path was buffered *because* head hoisting needed
the complete document, and concluded that "nothing on the streaming side moves until head
resolution does". Half of that held: the dependency was broken instead of resolved. `ssrStreaming:
true` now streams on Node and flushes the template head as its own write before React produces a
byte (`packages/theo/src/cli/commands/start/request-handler.ts:171`), while **metadata hoisting is
simply skipped on that path** — the source says so, in those words
(`packages/theo/src/cli/commands/start/request-handler.ts:167`). Streaming was unblocked by
dropping a correctness property, not by delivering one, and that trade is the state to hold in
mind when reading the rest of this file.

**The Web path is fixed in the helper and unfixed at its only caller.** `__theoDocumentStream`
takes `htmlHead` and `htmlTail` and defaults both to the empty string
(`packages/theo/src/router/entry-server.ts:177`). The Cloudflare adapter — the one generated entry
that calls the Web renderer — calls it as `renderStreamingWeb(request)`, with no options at all
(`packages/theo/src/adapters/cloudflare.ts:25`). So on Workers the response still carries no
`<html>`, no `<head>`, no stylesheet links and no client entry script; the hydration data script is
emitted, into a document with nothing to hydrate. The Bun adapter does not call it at all
(`packages/theo/src/adapters/bun.ts:21`).

**Not measured:** this is read from the emitter and the adapter template, not from a deployed
worker. No Cloudflare build was produced and no response body was inspected. The two sources agree
and the defaulting is unambiguous, but the runtime confirmation is missing and the step that closes
it is a test, not more reading.

**Dev never streams.** `theo dev` always calls `mod.render`
(`packages/theo/src/vite-plugin/ssr-dev-middleware.ts:127`), whatever `ssrStreaming` says. So the
option changes production behaviour only, and the shape a developer sees locally is not the shape
they deploy. That divergence was not stated in the previous version because there was nothing to
diverge from.

Two things still follow, and both are worth stating out loud in the framework's own documentation:

* **On the default path (`ssrStreaming: false`), boundaries isolate failure and deliver no latency
  benefit.** `loading.tsx` prevents one slow subtree from failing the page; it does not move the
  first byte.
* **The buffered path keeps one advantage the streamed path has already lost**: an error late in
  the render can still produce a real status code, because nothing has been sent. On the streaming
  path the status is committed at `onShellReady` (`packages/theo/src/router/entry-server.ts:314`)
  and a later `onError` only sets a flag that arrives too late to change it.

---

## What already works

Worth keeping and worth not regressing:

* **The nonce reaches every renderer.** All three pass `options.nonce` to React
  (`packages/theo/src/router/entry-server.ts:140`, `:312`, `:249`), so React's own boundary scripts
  carry it, and the generated hydration script stamps it too
  (`packages/theo/src/router/entry-server.ts:171`).
* **The nonce is minted before the HTML transform** (`packages/theo/src/cli/commands/start/request-handler.ts:240`),
  so inline scripts injected by the transform can be stamped — the ordering trap in
  `streaming-contract.md`, already avoided.
* **The template's own inline scripts get the per-request nonce**, on both the buffered and the
  streaming path (`packages/theo/src/cli/commands/start/request-handler.ts:121`,
  `packages/theo/src/cli/commands/start/request-handler.ts:171`). Without it a nonce-bearing CSP
  blocks the theme-init script applications put in `<head>` precisely to avoid a flash.
* **`onShellError` rejects and `onError` logs** on both Node entries
  (`packages/theo/src/router/entry-server.ts:142`, `:322`), so a shell failure is a real error
  rather than a blank page.
* **A `piped` guard** prevents a second pipe call, which would throw at runtime
  (`packages/theo/src/router/entry-server.ts:141`).
* **Abort is wired on the Node streaming path, and it reaches the data layer.** The production
  handler aborts on `req.close` (`packages/theo/src/cli/commands/start/request-handler.ts:156`),
  the entry forwards it to `stream.abort()` (`packages/theo/src/router/entry-server.ts:331`), and
  the same signal is attached to the `Request` the static handler queries
  (`packages/theo/src/router/entry-server.ts:287`) — so a disconnect cancels the loaders, not only
  the renderer.

  **Corrected.** The previous version listed *"Abort on the Node path"* as missing, with the
  consequence "a disconnected client leaves the render and its queries running". Both halves are
  now wired on the streaming path. It remains true on the buffered default path, which takes no
  signal at all (`packages/theo/src/cli/commands/start/request-handler.ts:194`).
* **The edge path honours `request.signal`** (`packages/theo/src/router/entry-server.ts:248`), so
  disconnects abort there.
* **Matched pages are preloaded before the render**, on all three entries, so `React.lazy` does not
  suspend on the page component and stream it in afterwards
  (`packages/theo/src/router/entry-server.ts:281`).
* **Metadata is hoisted into the head on the two non-streaming paths.** Production
  (`packages/theo/src/cli/commands/start/request-handler.ts:110`) and dev
  (`packages/theo/src/vite-plugin/ssr-dev-middleware.ts:154`) both do it, so a crawler that runs no
  JavaScript still sees a route's title and social card.
* **`ssr` is configurable per project**, so a client-only application does not pay for a server
  render it does not want.

---

## What is missing

| Missing | Consequence today |
|---|---|
| Head/tail at the Web renderer's only caller | The Cloudflare worker serves a bare React tree: no `<head>`, no stylesheets, no client entry, and hydration data for a page that will never hydrate (`packages/theo/src/adapters/cloudflare.ts:25`) |
| Render-time head resolution | Streaming and correct metadata are still mutually exclusive: the buffered path hoists, the streaming path does not (`packages/theo/src/cli/commands/start/request-handler.ts:167`) |
| Streaming in dev | `theo dev` always buffers (`packages/theo/src/vite-plugin/ssr-dev-middleware.ts:127`), so the streaming shape is never exercised locally |
| Abort on the buffered path | The default renderer takes no signal, so a disconnected client still pays for the render and its queries |
| Post-shell error rendering | The status is committed at shell flush (`packages/theo/src/router/entry-server.ts:314`); a later failure has no defined presentation |
| A first-byte regression guard | No test asserts first byte against completion, so the buffered shape can return unnoticed |
| Static shell / partial prerendering | Every route is request-time, however little of it needs the request |
| Prerender validation | Nothing detects a request-only read that would make a route dynamic |
| Enumerable params | No way to declare the values that could be prerendered |
| Boundary-structure parity between direct visit and navigation | Not applicable until prerendering exists — required the day it does |

**Removed from the 2026-08-19 list.** *"Streaming on the Node path"* — it exists behind
`ssrStreaming: true`. *"Abort on the Node path"* — wired on that same path, renderer and data layer
both.

---

## The order to close it

The dependency the previous version named is gone, and what replaced it is a correctness debt.

1. **Pass `htmlHead` and `htmlTail` at the Cloudflare call site.** Smallest item here and the only
   one that is currently serving a broken page in a supported deployment target. The helper already
   accepts them; the adapter has to split the template the way `setupSsr` does
   (`packages/theo/src/cli/commands/start/ssr-setup.ts:92`) and pass them through. Add a test that
   asserts the worker's response body contains `<head>` and the client entry.
2. **Resolve metadata during route resolution.** Emit `title`, description, canonical and Open
   Graph into the shell before the body renders. This is what makes streaming and correct metadata
   stop being alternatives. Keep post-render hoisting as the fallback for tags discovered deep in
   the body, or accept that those arrive late — but say which, in the framework's documentation,
   because today `ssrStreaming: true` silently costs a route its social card.
3. **Measure the shell.** Add a route with a deliberately slow boundary to the test suite and
   assert first byte against completion. Without this, steps 1 and 2 have no regression guard, and
   the buffered shape can come back unnoticed.
4. **Stream in dev too**, or state in the documentation that `ssrStreaming` is a production-only
   switch. A shape that is only ever exercised in production is a shape that breaks in production.
5. **Define what a post-shell failure renders**, and make monitoring separate shell errors from
   chunk errors. The status-code advantage was traded away when streaming landed; replacing it is
   overdue rather than pending.
6. **Wire the abort signal on the buffered path.** It is the default, and it is the path that
   currently keeps working after the client has gone.
7. **Boundary-aware error presentation.** An error boundary near each streaming boundary, so a late
   failure is explained rather than a hole.
8. **Enumerable params**, then **static shells** for routes whose shell needs nothing from the
   request.
9. **Prerender validation** — the same milestone as 8, not after it. Prerendering without
   validation degrades silently the first time someone reads a header in a layout.

Steps 1 to 3 are the ones that change what a user receives. Steps 8 and 9 are a larger programme
and depend on the caching work; read the caching-revalidation skill before starting them.
