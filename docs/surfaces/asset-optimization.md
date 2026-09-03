# Assets in this framework: what exists, and where it can be better than the field

Measured 2026-08-20 against `packages/theo/src/client/image.tsx`,
`packages/theo/src/server/http/static.ts`, `packages/http/src/static.ts`,
`packages/theo/src/vite-plugin/inject-stylesheets.ts` and `packages/theo/src/adapters/registry.ts`.
Re-measure before trusting. The 2026-08-19 pass came back clean on the two claims it made; both were
re-checked here and hold, and the corrections below are additions it missed rather than reversals.

## Contents

1. [What exists](#what-exists)
2. [What is deliberate](#what-is-deliberate)
3. [Parity gaps](#parity-gaps)
4. [Where this framework can be better](#where-this-framework-can-be-better)
5. [The order](#the-order)

---

## What exists

| Capability | Shape | Evidence |
|---|---|---|
| `<Image>` component | A plain `<img>` with `loading="lazy"` by default, `decoding="async"`, everything else forwarded through the spread — so `width`/`height`/`srcSet`/`sizes` pass to the DOM untouched, and `priority` switches `loading` to eager | `packages/theo/src/client/image.tsx:42-49` |
| Exported from the public client entry | `import { Image } from 'theokit/client'` resolves | `packages/theo/src/client/index.ts:77` |
| Static file serving in production | Extension-to-MIME map, path-traversal guard, whole-file synchronous read per request | `packages/theo/src/server/http/static.ts:11-28,37-42,52-58`, wired at `packages/theo/src/cli/commands/start/handlers.ts:473` and reached from `packages/theo/src/cli/commands/start/request-handler.ts:258` |
| A second, richer static handler | `@theokit/http` ships one with `.webp`/`.avif` in the MIME table and an optional `maxAge` | `packages/http/src/static.ts:38-39,188-192,238-240` |
| Fonts | Nothing framework-side. No loader, no subsetting, no fallback generation, no preload | recorded decision at `packages/theo/src/vite-plugin/inject-stylesheets.ts:36-53` and `packages/theo/src/vite-plugin/transform-html-hook.ts:44-50` |

**Addition the 2026-08-19 pass missed — `<Image>` has no production caller.** The symbol is exported
and documented, and nothing in this repository renders it: `command grep -rn "<Image" packages` matches
only its own definition and its own doc comment (`packages/theo/src/client/image.tsx:17-19,42`). The
scaffold every new project starts from uses `<Link>` and `<Metadata>` and never `<Image>`
(`packages/create-theokit/templates/default/src/app/about/page.tsx:40`,
`packages/create-theokit/templates/default/src/app/page.tsx:41`). It is a public surface, not dead code —
but the distinction matters here, because it means no path in this repository exercises it, and any
future transform contract would be landing on a component nobody in-tree consumes yet.

**Addition the 2026-08-19 pass missed — the production static server is the weaker of the two.**
`theokit start` serves through `packages/theo/src/server/http/static.ts`, whose response carries only
`Content-Type` and `Content-Length` (`packages/theo/src/server/http/static.ts:52-58`): no
`Cache-Control`, no `ETag`, no `Last-Modified`, so Vite's content-hashed bundles are re-downloaded on
every visit and never revalidated. Its MIME table has no `.webp` and no `.avif`
(`packages/theo/src/server/http/static.ts:11-28`), so an author who produced modern formats by hand
gets them served as `application/octet-stream`. The handler that does know those types
(`packages/http/src/static.ts:38-39`) is reachable only through `@theokit/http`'s own app
(`packages/http/src/app.ts:307`), which `theokit start` does not use.

---

## What is deliberate

The component's own documentation states the position: no CDN, no image processing library, no
build-time optimisation — "pure HTML attributes that deliver 80% of the performance value at zero
complexity" (`packages/theo/src/client/image.tsx:10-11`).

That is a defensible trade and worth stating clearly rather than treating as a gap:

* **Dimensions and lazy loading are where most of the layout-shift and byte savings come from.** They
  cost nothing and require no infrastructure.
* **An image pipeline is real infrastructure**: encoders, variant storage, cache invalidation, an
  allowlist, resource limits. Shipping it badly is worse than not shipping it.

The font position is deliberate too, and it is written down rather than merely absent: framework-side
font preload was added, measured, and reverted, because the dev symlink path and the production hashed
path disagree, and because the CLS being chased was a hydration mismatch
(`packages/theo/src/vite-plugin/inject-stylesheets.ts:36-53`). The comment names the correct fix and
names its owner: `font-display: optional` or size-adjust metric matching **inside `@theokit/ui`**
(`packages/theo/src/vite-plugin/inject-stylesheets.ts:51-53`).

**That named owner does not currently do it.** `@theokit/ui` is a dependency of `packages/theo`
(`./pnpm-lock.yaml:288-290`) and its source lives **outside this repository**, so this is measured
against the installed published artifact, version 1.3.2, and not against source: its `dist/fonts.css`
declares six self-hosted Geist faces, every one of them `font-display: swap`, with no `size-adjust`,
no `ascent-override`, no `descent-override` and no `unicode-range`. That is the exact configuration
that produces swap shift. The framework-side decision to not preload is sound; the assumption that the
UI package handles the rest is, as of this measurement, not true.

The honest addition to the whole position: the remaining 20% is where the *largest paint* lives, and it
is the metric users feel. So the trade is right for a framework's first version and wrong as a
permanent answer.

---

## Parity gaps

| Missing | Consequence | Evidence |
|---|---|---|
| Any image transformation | A 3000-pixel source is delivered to a 390-pixel column | `packages/theo/src/client/image.tsx:42-49` emits the `src` it was given |
| Modern format delivery | AVIF/WebP only if the author produced them by hand — and then the production server mislabels them | `packages/theo/src/server/http/static.ts:11-28` has neither extension |
| Candidate generation | `srcset` is authored manually or not at all | no `srcSet` construction in `packages/theo/src/client/image.tsx:29-49` |
| Automatic `sizes` guidance | The attribute that makes `srcset` work is the one most often omitted, and nothing warns | same |
| Cache headers on static assets | Content-hashed bundles, fonts and images are re-fetched every visit | `packages/theo/src/server/http/static.ts:52-58` |
| Hero preload | The largest paint is never prioritised automatically | `priority` only flips `loading` (`packages/theo/src/client/image.tsx:45`); nothing emits a `<link rel="preload">` |
| Placeholders | White box until the image decodes | no placeholder path in `packages/theo/src/client/image.tsx:29-49` |
| Font loading | Everything framework-side: no subsetting, no display strategy, no preload, no fallback metrics | `packages/theo/src/vite-plugin/inject-stylesheets.ts:36-53` |
| Remote source handling | Not applicable yet — mandatory the day transformation lands | — |
| Build gates for any of the above | `theokit check` runs typecheck, eslint and the route scan, and nothing else | `packages/theo/src/cli/commands/check.ts:7-9` |

**Not measured.** Whether Vite's own production build emits font preload metadata for faces referenced
from compiled CSS — asserted at `packages/theo/src/vite-plugin/inject-stylesheets.ts:47-48` — was not
verified here. It is a claim about the bundler's output, and confirming it needs a built artifact
rather than source. Treat it as the framework's stated belief, not as a measured fact.

---

## Where this framework can be better

The field's implementations grew around a hosted image service and a font loader tied to one vendor's
catalogue. A framework choosing now can take four positions the incumbents cannot:

### 1. Optimisation as an adapter concern, not a service

This framework has nine deploy targets behind one registry
(`packages/theo/src/adapters/registry.ts:25-34`), dispatched from the build command
(`packages/theo/src/cli/commands/build.ts:222`). Image optimisation fits that model exactly: a
**transform contract** the build emits, and per-target implementations — build-time locally, the
platform's own image API on platforms that have one, a CDN where configured, and a Node fallback.

The incumbents bind their optimiser to their own hosting and then bolt on a "custom loader" escape
hatch. Starting from the adapter contract inverts that: every target is first-class, and the authoring
surface never changes. That is a better design, and it is available because the adapter registry
already exists and is already the dispatch path rather than a parallel one.

### 2. Generate metric-matched font fallbacks automatically

The technique that removes font swap shift entirely is mechanical: read both fonts' metric tables,
compute four override values, emit a fallback face. Almost nobody does it, because it requires having
both fonts at build time and doing arithmetic — which is exactly what a build step can do.

A framework where `font-display: swap` costs **zero** layout shift by default, without the author
knowing the technique exists, is meaningfully better than one where the author must discover it. The
incumbents do this only for their bundled font providers. The measurement above sharpens the argument:
the bundled provider here (`@theokit/ui@1.3.2`) ships `swap` with no overrides, so "the UI package will
handle it" is not a plan — it is the gap, one package over.

### 3. Fail the build on the static asset defects

The gates in `budgets-and-measurement.md` — missing dimensions, `srcset` without `sizes`, a lazy hero,
a font family without a metric fallback, byte budgets, an empty optimiser allowlist — are all
statically checkable over the built output, and **none of them fails a build in any mainstream
framework**. None of them fails a build here either: `theokit check` is typecheck, eslint and the route
scan (`packages/theo/src/cli/commands/check.ts:7-9`). They are all discovered in a performance audit
weeks later.

Shipping them as build gates is the highest-leverage item in this file: it converts the entire
discipline from expertise into a default.

### 4. Attribute the metric to the file

A framework that knows which element came from which source file can report layout shift and paint
regressions with a file and line, rather than a CSS selector. Generic tools cannot do this. It turns
"CLS is 0.24" into a task list.

---

## The order

1. **Build gates for what needs no infrastructure**: every image has dimensions or a ratio, no lazy
   hero, `srcset` implies `sizes`. Days of work, and it removes the most common defects permanently.
2. **Cache headers and the missing MIME types on the production static server.** Hours of work, no new
   concepts, and it is the only item here that is currently costing bytes on every single request
   (`packages/theo/src/server/http/static.ts:11-28,52-58`). The richer handler already exists one
   package over (`packages/http/src/static.ts:38-39,238-240`) — decide whether to converge on it or to
   fix the one in use, but do not leave two.
3. **A font module**: self-hosted loading, subsetting by unicode range, `font-display` as an explicit
   choice, preload for the primary family — and **automatic metric-matched fallback generation** as the
   headline feature. Independent of the image work; the largest single stability win available. Settle
   first whether it lands here or in `@theokit/ui`, because the current comment delegates it and the
   delegate does not do it.
4. **The transform contract**: define what the build emits for an image variant — source, transform,
   content-addressed output — without implementing any transformer yet.
5. **A build-time transformer** for repository images against that contract: candidate widths from the
   layout's breakpoints, modern formats with fallback, content-addressed output.
6. **Per-target adapters** for the same contract: platform image APIs where they exist, CDN where
   configured, a Node on-demand path with allowlist, limits and cache headers.
7. **Hero declaration and automatic preload**, once the transform contract exists — the framework can
   then emit the correctly-typed preload for the right variant.
8. **Placeholders** (dominant colour, then blurred miniature), computed at transform time.
9. **Metric attribution** in the dev overlay and in CI.

Steps 1–3 need no infrastructure and deliver most of the measurable gain. Steps 4–6 are where the
adapter-first position pays off, and they should not start before the contract in step 4 is written
down.
