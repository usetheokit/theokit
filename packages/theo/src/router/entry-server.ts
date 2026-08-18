import type { TheoUiTheme } from '../core/contracts/theo-ui-theme.js'

interface EntryServerOptions {
  /** When true, emit a streaming entry using onShellReady + signal cleanup.
   *  When false (default), emit the legacy single-shot onAllReady entry. */
  streaming?: boolean
  /**
   * TheoUI config — when present, the SSR React tree wraps StaticRouterProvider
   * in <TheoUIProvider> + <Suspense> to MATCH the client entry exactly. Without
   * this, hydration falls back silently because the trees differ — button
   * onClick handlers never get attached and the page looks dead.
   *
   * EC-2 (CSS): the SSR entry never imports CSS. Only the React tree is
   * mirrored — the CSS stays client-only.
   */
  theoUi?: { theme?: TheoUiTheme }
}

export function generateEntryServer(options: EntryServerOptions = {}): string {
  if (options.streaming) {
    return generateStreamingEntry(options)
  }
  return generateSingleShotEntry(options)
}

/**
 * Build the React element tree the server renders. Must mirror the client
 * tree shape from `generateEntryClient` — same wrapper components, same
 * order — or hydration silently falls back to client-only render.
 */
function buildAppTreeJs(options: EntryServerOptions): string {
  const theme = options.theoUi?.theme ?? 'violet-forge'
  // T4.1 — pass options.nonce to StaticRouterProvider so its internal
  // hydration data script (`<script>window.__staticRouterHydrationData
  // = ...</script>`) carries the nonce attribute. Without this, CSP
  // enforce mode (without 'unsafe-inline') blocks the hydration script
  // → React falls back to client-only render → button onClick handlers
  // never attach → page looks dead. The nonce option to
  // renderToPipeableStream covers React-emitted scripts but NOT the
  // hydration script which is emitted by react-router itself.
  // hydrate: false — CRITICAL fix for hydration mismatch.
  //
  // StaticRouterProvider with `hydrate: true` (default) emits
  // `<script>window.__staticRouterHydrationData = ...</script>` INSIDE
  // the React tree. The client's `<RouterProvider>` does NOT emit any
  // script. React's reconciler sees server={...stuff, <script>} vs
  // client={...stuff} and DISCARDS the entire server tree, regenerating
  // from scratch on the client. That regeneration causes a massive
  // layout shift (CLS 0.39 measured in the example).
  //
  // Fix: tell StaticRouterProvider to NOT emit the script. The framework
  // emits the hydration data as a separate `<script>` in the HTML
  // template (outside #root), via the `hydrationData` returned from
  // `render()`. The script still runs BEFORE entry-client.js, so
  // window.__staticRouterHydrationData is populated when
  // createBrowserRouter reads it.
  if (options.theoUi) {
    return [
      `React.createElement(TheoUIProvider, { theme: { defaultTheme: '${theme}' } },`,
      `      React.createElement(Suspense, { fallback: null },`,
      `        React.createElement(StaticRouterProvider, { router, context, hydrate: false })`,
      `      )`,
      `    )`,
    ].join('\n')
  }
  return `React.createElement(Suspense, { fallback: null },\n      React.createElement(StaticRouterProvider, { router, context, hydrate: false })\n    )`
}

/**
 * Generate the hydration data extraction snippet. Reads
 * loaderData/actionData/errors from the StaticHandlerContext and returns
 * them as an object the framework can serialize into a `<script>` tag.
 */
function hydrationDataExtractSnippet(): string {
  return [
    `    const hydrationData = {`,
    `      loaderData: context.loaderData,`,
    `      actionData: context.actionData,`,
    `      errors: context.errors,`,
    `    }`,
  ].join('\n')
}

function generateSingleShotEntry(options: EntryServerOptions): string {
  const theoUiImport = options.theoUi ? `import { TheoUIProvider } from '@theokit/ui'\n` : ''
  const appTree = buildAppTreeJs(options)
  return [
    `import React, { Suspense } from 'react'`,
    `import { renderToPipeableStream } from 'react-dom/server'`,
    `import { createStaticHandler, createStaticRouter, StaticRouterProvider, matchRoutes } from 'react-router'`,
    `import { PassThrough } from 'node:stream'`,
    `import { routes, __theoPreloadMap } from '/@theo/route-manifest'`,
    theoUiImport,
    `export async function render(url, options = {}) {`,
    // Resolve the matched pages BEFORE rendering.
    //
    // Pages are React.lazy() in the route manifest, which is right for the browser and pure loss
    // here: the server already has every chunk on local disk. Rendering without this makes React
    // suspend on the page component, so \`onShellReady\` fires with the layout alone and the actual
    // page streams afterwards inside a hidden div. The reader gets an empty frame that fills in --
    // measured at CLS 1.12 and an article absent from the DOM for ~700ms on a real site.
    //
    // This mirrors what entry.ts already does before hydrateRoot, using the same preload map.
    // Streaming still applies to genuine data-fetching Suspense, which is where it earns its keep.
    // A failed import is swallowed on purpose: React.lazy will retry and suspend as before, which
    // is strictly no worse than not having preloaded at all.
    `  const __theoMatches = matchRoutes(routes, url.split('?')[0]) ?? []`,
    `  await Promise.all(`,
    `    __theoMatches`,
    `      .map((m) => m.route && m.route.path)`,
    `      .filter((p) => typeof p === 'string' && p in __theoPreloadMap)`,
    `      .map((p) => __theoPreloadMap[p]().catch(() => null)),`,
    `  )`,
    ``,
    `  const handler = createStaticHandler(routes)`,
    `  const request = new Request('http://localhost' + url)`,
    `  const context = await handler.query(request)`,
    ``,
    `  if (context instanceof Response) {`,
    `    return { redirect: context }`,
    `  }`,
    ``,
    `  const router = createStaticRouter(handler.dataRoutes, context)`,
    `  const app = ${appTree}`,
    ``,
    hydrationDataExtractSnippet(),
    ``,
    `  return new Promise((resolve, reject) => {`,
    `    let html = ''`,
    `    let piped = false`,
    `    const passthrough = new PassThrough()`,
    `    passthrough.on('data', (chunk) => { html += chunk.toString() })`,
    `    passthrough.on('end', () => { resolve({ html, hydrationData }) })`,
    `    passthrough.on('error', reject)`,
    ``,
    `    // Pipe on onShellReady (Next.js pattern). Calling pipe() twice`,
    `    // throws "React currently only supports piping to one writable`,
    `    // stream". The \`piped\` flag is a belt-and-suspenders guard if`,
    `    // onShellReady fires unexpectedly more than once.`,
    `    // Forward options.nonce to React so every <script> tag React`,
    `    // emits (Suspense boundary scripts) carries the nonce attribute.`,
    `    const { pipe } = renderToPipeableStream(app, {`,
    `      nonce: options.nonce,`,
    `      onShellReady() { if (!piped) { piped = true; pipe(passthrough) } },`,
    `      onShellError(err) { reject(err) },`,
    `      onError(err) { console.error('[SSR Error]', err) },`,
    `    })`,
    `  })`,
    `}`,
  ].join('\n')
}

// Generated-code fragments — extracted so the parent emitter stays under
// the max-lines-per-function ceiling.
function streamingWebRenderer(appTree: string): string[] {
  return [
    `// T2.3 — Web Standards streaming entry for edge runtimes (Cloudflare,`,
    `// Bun, Deno, Vercel Edge). Uses renderToReadableStream and returns a`,
    `// Response with the stream as body. Honors request.signal for client`,
    `// disconnect cleanup.`,
    `export async function renderStreamingWeb(request, options = {}) {`,
    // Resolve the matched pages BEFORE rendering.
    //
    // Pages are React.lazy() in the route manifest, which is right for the browser and pure loss
    // here: the server already has every chunk on local disk. Rendering without this makes React
    // suspend on the page component, so \`onShellReady\` fires with the layout alone and the actual
    // page streams afterwards inside a hidden div. The reader gets an empty frame that fills in --
    // measured at CLS 1.12 and an article absent from the DOM for ~700ms on a real site.
    //
    // This mirrors what entry.ts already does before hydrateRoot, using the same preload map.
    // Streaming still applies to genuine data-fetching Suspense, which is where it earns its keep.
    // A failed import is swallowed on purpose: React.lazy will retry and suspend as before, which
    // is strictly no worse than not having preloaded at all.
    `  const __theoMatches = matchRoutes(routes, url.split('?')[0]) ?? []`,
    `  await Promise.all(`,
    `    __theoMatches`,
    `      .map((m) => m.route && m.route.path)`,
    `      .filter((p) => typeof p === 'string' && p in __theoPreloadMap)`,
    `      .map((p) => __theoPreloadMap[p]().catch(() => null)),`,
    `  )`,
    ``,
    `  const handler = createStaticHandler(routes)`,
    `  const url = new URL(request.url)`,
    `  const context = await handler.query(request)`,
    ``,
    `  if (context instanceof Response) {`,
    `    return context`,
    `  }`,
    ``,
    `  const router = createStaticRouter(handler.dataRoutes, context)`,
    `  const app = ${appTree}`,
    ``,
    `  const stream = await renderToReadableStream(app, {`,
    `    signal: request.signal,`,
    `    nonce: options.nonce,`,
    `    onError(err) { console.error('[SSR Web Stream Error]', err) },`,
    `  })`,
    `  return new Response(stream, {`,
    `    status: 200,`,
    `    headers: {`,
    `      'Content-Type': 'text/html; charset=utf-8',`,
    `      'Transfer-Encoding': 'chunked',`,
    `    },`,
    `  })`,
    `}`,
  ]
}

function streamingNodeRenderer(appTree: string): string[] {
  return [
    `// T6.1 — Node streaming SSR entry (opt-in via theo.config.ts > ssrStreaming: true)`,
    `// Flushes the shell as soon as it's ready, then streams Suspense boundaries.`,
    `// EC-11: respects request.signal for client-disconnect cleanup.`,
    `export async function renderStreaming(url, response, options = {}) {`,
    // Resolve the matched pages BEFORE rendering.
    //
    // Pages are React.lazy() in the route manifest, which is right for the browser and pure loss
    // here: the server already has every chunk on local disk. Rendering without this makes React
    // suspend on the page component, so \`onShellReady\` fires with the layout alone and the actual
    // page streams afterwards inside a hidden div. The reader gets an empty frame that fills in --
    // measured at CLS 1.12 and an article absent from the DOM for ~700ms on a real site.
    //
    // This mirrors what entry.ts already does before hydrateRoot, using the same preload map.
    // Streaming still applies to genuine data-fetching Suspense, which is where it earns its keep.
    // A failed import is swallowed on purpose: React.lazy will retry and suspend as before, which
    // is strictly no worse than not having preloaded at all.
    `  const __theoMatches = matchRoutes(routes, url.split('?')[0]) ?? []`,
    `  await Promise.all(`,
    `    __theoMatches`,
    `      .map((m) => m.route && m.route.path)`,
    `      .filter((p) => typeof p === 'string' && p in __theoPreloadMap)`,
    `      .map((p) => __theoPreloadMap[p]().catch(() => null)),`,
    `  )`,
    ``,
    `  const handler = createStaticHandler(routes)`,
    `  const request = new Request('http://localhost' + url, { signal: options.signal })`,
    `  const context = await handler.query(request)`,
    ``,
    `  if (context instanceof Response) {`,
    `    return { redirect: context }`,
    `  }`,
    ``,
    `  const router = createStaticRouter(handler.dataRoutes, context)`,
    `  const app = ${appTree}`,
    ``,
    `  return new Promise((resolve, reject) => {`,
    `    let didError = false`,
    `    const stream = renderToPipeableStream(app, {`,
    `      nonce: options.nonce,`,
    `      onShellReady() {`,
    `        response.statusCode = didError ? 500 : 200`,
    `        response.setHeader('Content-Type', 'text/html; charset=utf-8')`,
    `        response.setHeader('Transfer-Encoding', 'chunked')`,
    `        stream.pipe(response)`,
    `        resolve({ streaming: true })`,
    `      },`,
    `      onShellError(err) { reject(err) },`,
    `      onError(err) {`,
    `        didError = true`,
    `        console.error('[SSR Stream Error]', err)`,
    `      },`,
    `    })`,
    ``,
    `    // EC-11: client disconnect cleanup`,
    `    if (options.signal) {`,
    `      options.signal.addEventListener('abort', () => { stream.abort() })`,
    `    }`,
    `  })`,
    `}`,
  ]
}

function backCompatRenderer(appTree: string): string[] {
  return [
    `// Backward compatibility: keep the single-shot render export available so`,
    `// callers that always used 'render()' don't break when streaming is on.`,
    `export async function render(url, options = {}) {`,
    // Resolve the matched pages BEFORE rendering.
    //
    // Pages are React.lazy() in the route manifest, which is right for the browser and pure loss
    // here: the server already has every chunk on local disk. Rendering without this makes React
    // suspend on the page component, so \`onShellReady\` fires with the layout alone and the actual
    // page streams afterwards inside a hidden div. The reader gets an empty frame that fills in --
    // measured at CLS 1.12 and an article absent from the DOM for ~700ms on a real site.
    //
    // This mirrors what entry.ts already does before hydrateRoot, using the same preload map.
    // Streaming still applies to genuine data-fetching Suspense, which is where it earns its keep.
    // A failed import is swallowed on purpose: React.lazy will retry and suspend as before, which
    // is strictly no worse than not having preloaded at all.
    `  const __theoMatches = matchRoutes(routes, url.split('?')[0]) ?? []`,
    `  await Promise.all(`,
    `    __theoMatches`,
    `      .map((m) => m.route && m.route.path)`,
    `      .filter((p) => typeof p === 'string' && p in __theoPreloadMap)`,
    `      .map((p) => __theoPreloadMap[p]().catch(() => null)),`,
    `  )`,
    ``,
    `  const handler = createStaticHandler(routes)`,
    `  const request = new Request('http://localhost' + url)`,
    `  const context = await handler.query(request)`,
    ``,
    `  if (context instanceof Response) {`,
    `    return { redirect: context }`,
    `  }`,
    ``,
    `  const router = createStaticRouter(handler.dataRoutes, context)`,
    `  const app = ${appTree}`,
    ``,
    hydrationDataExtractSnippet(),
    ``,
    `  const { PassThrough } = await import('node:stream')`,
    `  return new Promise((resolve, reject) => {`,
    `    let html = ''`,
    `    let piped = false`,
    `    const passthrough = new PassThrough()`,
    `    passthrough.on('data', (chunk) => { html += chunk.toString() })`,
    `    passthrough.on('end', () => { resolve({ html, hydrationData }) })`,
    `    passthrough.on('error', reject)`,
    ``,
    `    // Pipe on onShellReady (Next.js pattern). nonce forwarded.`,
    `    const { pipe } = renderToPipeableStream(app, {`,
    `      nonce: options.nonce,`,
    `      onShellReady() { if (!piped) { piped = true; pipe(passthrough) } },`,
    `      onShellError(err) { reject(err) },`,
    `      onError(err) { console.error('[SSR Error]', err) },`,
    `    })`,
    `  })`,
    `}`,
  ]
}

function generateStreamingEntry(options: EntryServerOptions): string {
  const theoUiImport = options.theoUi ? `import { TheoUIProvider } from '@theokit/ui'\n` : ''
  const appTree = buildAppTreeJs(options)
  return [
    `import React, { Suspense } from 'react'`,
    `import { renderToPipeableStream, renderToReadableStream } from 'react-dom/server'`,
    `import { createStaticHandler, createStaticRouter, StaticRouterProvider, matchRoutes } from 'react-router'`,
    `import { routes, __theoPreloadMap } from '/@theo/route-manifest'`,
    theoUiImport,
    ``,
    ...streamingWebRenderer(appTree),
    ``,
    ...streamingNodeRenderer(appTree),
    ``,
    ...backCompatRenderer(appTree),
  ].join('\n')
}
