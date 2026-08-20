# Metadata in this framework: what exists, what is missing, and where it can be better than the field

Measured 2026-08-20 against `packages/theo/src/client/metadata.tsx`,
`packages/theo/src/vite-plugin/hoist-head-tags.ts`,
`packages/theo/src/cli/commands/start/request-handler.ts`,
`packages/theo/src/vite-plugin/ssr-dev-middleware.ts`, `packages/theo/src/router/entry-server.ts`
and `packages/theo/src/adapters/static.ts`. Re-measure before trusting: the 2026-08-19 pass of this
file was wrong in both directions, and every correction below says what the earlier text claimed
instead of quietly replacing it.

## Contents

1. [What exists](#what-exists)
2. [Parity gaps](#parity-gaps)
3. [Where this framework can be better](#where-this-framework-can-be-better)
4. [The order](#the-order)

---

## What exists

| Capability | Shape | Evidence |
|---|---|---|
| `<Metadata>` component | Emits `title`, `description`, `link rel="canonical"`, `og:title`, `og:description`, `og:image`, `og:type`, `og:url`, `twitter:card`, plus any tag passed as `children` | `packages/theo/src/client/metadata.tsx:44-58` |
| It is reachable, not just exported | Exported from the public client entry and used by the scaffold on two routes — this is a capability with production callers, not an orphan symbol | `packages/theo/src/client/index.ts:73`, `packages/create-theokit/templates/default/app/page.tsx:41`, `packages/create-theokit/templates/default/app/about/page.tsx:14` |
| Head hoisting on the **non-streaming** SSR path | Post-render rewrite: pull `<title>`/`<meta>`/`<link>` out of the rendered body, drop the template tags they supersede, insert before `</head>` | `packages/theo/src/vite-plugin/hoist-head-tags.ts:86,101,125`, wired in production at `packages/theo/src/cli/commands/start/request-handler.ts:110-121,131,140` and in dev at `packages/theo/src/vite-plugin/ssr-dev-middleware.ts:154` |
| Defined supersession slots | Keyed by `title`, `name:*`, `property:*`, `link:canonical`, `link:manifest`; every other `rel` is treated as additive and appended rather than evicted | `packages/theo/src/vite-plugin/hoist-head-tags.ts:56-78` |
| Client-side hoisting | React 19 moves the tags into the head after hydration — in the browser only | `packages/theo/src/vite-plugin/hoist-head-tags.ts:5-9` |

**Correction to the 2026-08-19 measurement.** That pass wrote *"Head hoisting — two paths: native
hoisting of head tags by the renderer, plus a post-render rewrite"*. On the server there is one path:
the rewrite. React emits these tags inline wherever the component sat and only hoists them in the
browser after hydration (`packages/theo/src/vite-plugin/hoist-head-tags.ts:5-9`), which is precisely
why the rewrite exists. Counting the browser as a second server path overstates what a crawler gets.

**Correction to the 2026-08-19 measurement.** That pass listed `twitter` under absent field coverage.
`twitterCard` is a declared prop and emits `<meta name="twitter:card">`
(`packages/theo/src/client/metadata.tsx:36,56`). The rest of the card fields — `twitter:title`,
`twitter:description`, `twitter:image`, `twitter:site` — are genuinely absent.

The design decision behind it is sound and worth keeping: **no build-time extraction step**. Metadata
is authored where the page is authored, in one component, with no parallel export to keep in sync.

---

## Parity gaps

| Missing | Consequence | Evidence |
|---|---|---|
| Route-level resolution | Metadata is knowable only after the component renders, which is what forces the rewrite to run over an already-rendered body | `packages/theo/src/vite-plugin/hoist-head-tags.ts:86` takes rendered SSR markup as its input |
| Hoisting under streaming | With `ssrStreaming: true` the template head is written **before** React produces a byte, and nothing hoists afterwards — so a route's own `<title>` and `og:` tags ship inside the body | `packages/theo/src/cli/commands/start/request-handler.ts:161-176` passes `htmlHead` and states the reason in a comment; Node writes it at `packages/theo/src/router/entry-server.ts:318`, the Web path at `packages/theo/src/router/entry-server.ts:177,182` |
| Hoisting on the `static` target | Prerendered documents get no rewrite at all; the head is whatever `index.html` carried | `packages/theo/src/adapters/static.ts:163-169` splices the render result after `<div id="root">` with no hoist step |
| Title templates | Every page repeats the site name, or none has it | no template or merge prop exists on `packages/theo/src/client/metadata.tsx:27-39` |
| Field coverage | No `robots`, `alternates`/`hreflang`, `icons`, `themeColor`, `viewport`, `verification`, `manifest` or structured data as typed props | `packages/theo/src/client/metadata.tsx:27-39` |
| A declared base URL | Nothing resolves a relative URL to an absolute one — the most common metadata defect has no guard | no site or base URL field in `packages/theo/src/config/schema.ts:1-330`, and no resolution step anywhere in `packages/theo/src/client/metadata.tsx` |
| `sitemap.xml`, `robots.txt`, `manifest.webmanifest` | Not generated, though the framework owns the route table that would generate them | `command grep -rn "sitemap\|robots.txt\|webmanifest" packages/*/src` matches only a MIME table entry, `packages/http/src/static.ts:70` |
| Generated social images | No mechanism | same sweep; nothing renders or caches an image per route |
| Merge semantics **between two routes** | `injectIntoHead` dedupes template tags against the route's key set, but never dedupes the route's tags against each other — two `<Metadata title>` in one tree produce two `<title>` in the head | `packages/theo/src/vite-plugin/hoist-head-tags.ts:101-118` |
| Metadata from fetched data | Possible, but it pushes resolution later and makes the rewrite mandatory | `packages/theo/src/vite-plugin/hoist-head-tags.ts:125-143` |

**Correction to the 2026-08-19 measurement.** That pass wrote that route-level resolution being
missing *"is why the Node path cannot stream"*. The Node path streams today: `theokit start` takes
the streaming branch when `ssrStreaming` is on and the SSR build exported `renderStreaming`
(`packages/theo/src/cli/commands/start/request-handler.ts:153`), and it now assembles a real document
around it. What streaming cannot do is **hoist** — the head has to flush before React renders, so
there is no rendered body to read metadata out of yet. Streaming and hoisting are the two claims most
easily confused here, and the earlier file collapsed them into one.

**Correction to the 2026-08-19 measurement.** That pass wrote *"Merge semantics — undefined: two
`<Metadata>` in one tree is unspecified behaviour"*. Route-versus-template merge is specified and
implemented: the route wins, keyed slot by keyed slot, with additive rels left alone
(`packages/theo/src/vite-plugin/hoist-head-tags.ts:56-78,101-118`). What is unspecified is
route-versus-route, and the observable result of it is duplication rather than ambiguity.

**Not measured.** Whether a real crawler accepts the streamed document is not measurable from source.
The closest existing evidence is `tests/unit/entry-server-web-execution.test.ts:116-131`, which proves
the **first chunk carries a `<head>`** — but that head is the template's, so the test does not speak
to route metadata, and it should not be read as if it did.

---

## Where this framework can be better

The field's mature implementations carry decisions made under compatibility pressure. A framework
choosing now is not bound by them. Five places where the better choice is available and unclaimed:

### 1. Validate metadata at build time, not in production

Every metadata defect in this skill — a relative social image, an inherited `noindex`, a canonical
pointing elsewhere, a manifest with 404 icons, a missing reciprocal alternate — is **statically
detectable**, and no mainstream framework fails a build for any of them. They are all discovered in
production, weeks later, by someone reading an analytics graph.

A build that refuses to complete when a metadata URL is relative, when a route resolves to `noindex`
without an explicit opt-in, or when a declared icon does not exist, is a genuinely better product. The
information is all present at build time; the field simply does not use it.

The precedent for a refusal like this already exists in the route scanner, which throws by name on an
unsupported segment shape rather than mis-matching at runtime
(`packages/theo/src/router/scan.ts:68-93`).

### 2. Make the resolution chain queryable

"Which layer set this tag?" is answered today by bisecting. A framework that owns the route tree can
answer it directly:

```text
$ theokit metadata /blog/hello
title      "Hello — Acme"      page → template from app/layout
robots     index, follow       inherited from app/(marketing)/layout   ⚠
canonical  https://…/blog/hello  page (self-referential)  ✓
og:image   https://…/og/hello.png  page                    ✓ 42KB image/png
```

No mainstream framework ships this, and this one does not either: the sixteen commands registered
between `packages/theo/src/cli/index.ts:18` and `packages/theo/src/cli/index.ts:258` include no
`metadata`. It costs little once resolution is centralised, and it converts the most common metadata
question into a command.

### 3. Test what the crawler sees, in the suite

The four validations in `social-and-structured-data.md` are mechanical, and every one of them is a
launch-checklist item everywhere rather than a test. A framework that ships a test helper — fetch the
route as a machine, assert the tags, fetch the image, validate the structured data — puts the whole
class under regression control.

The suite already knows how to do the mechanical half: it executes a generated entry against a real
`Request` and reads the stream chunk by chunk
(`tests/unit/entry-server-web-execution.test.ts:116-131`). What is missing is the assertion about
resolved metadata, not the instrument.

### 4. Type metadata against the route table

The framework already generates route types (`packages/theo/src/cli/commands/generate-types.ts:1-45`,
`packages/theo/src/router/generate.ts:136-150`). Metadata typed per route means a canonical that
cannot point at a route that does not exist, and an alternates map that must cover the declared locale
set. Both are compile errors that nobody currently gets.

### 5. Resolve before the shell, by construction

The field is retrofitting streaming-compatible metadata onto designs that assumed a complete document.
This framework has not exported the rewrite as a public module — `packages/theo/package.json:25-70`
publishes no subpath for it — so the *API* is still free. The *behaviour*, however, already ships in
every non-streaming SSR response, and the streaming path already diverges from it. So the honest
statement is narrower than the 2026-08-19 one: the retrofit is half-owned already, and route-level
resolution is what would collapse the three paths (`start` sync, `start` streaming, `static`
prerender) back into one. That is the same decision that unblocks streaming in the rendering pipeline.

---

## The order

1. **A declared base URL, and absolute resolution of every metadata URL.** One config value, one
   resolution step, one build-time refusal when it is missing. Removes the most common defect in the
   discipline.
2. **Route-level metadata resolution**, running before the body renders. Shared milestone with the
   rendering pipeline's step 1 — read that gap file first; the two are one piece of work. This is what
   makes the streaming head correct rather than merely present.
3. **Title templates with an absolute opt-out**, and defined merge semantics for every field —
   including route-versus-route, which today duplicates. Write the merge table down before
   implementing it.
4. **Field coverage**, in consumer order: `robots`, the rest of `twitter`, `alternates`, `icons`,
   `themeColor`, `manifest`.
5. **Build-time validation** (item 1 above): relative URLs, inherited `noindex`, missing icons,
   non-reciprocal alternates, absent base.
6. **`theokit metadata <route>`** (item 2 above). Cheap once resolution is centralised.
7. **Generated `sitemap.xml`, `robots.txt` and manifest**, from the route table plus enumerable params.
8. **Test helpers** for the crawler view (item 3).
9. **Generated social images**, as a separate cacheable resource — last, because it is the only item
   that needs new infrastructure rather than new resolution.

Steps 1–3 are the foundation and are worth doing together. Steps 5, 6 and 8 are where this stops being
a catch-up list and starts being an argument for choosing this framework over the incumbent.
