/**
 * B-035 — the STREAMING SSR path must preload the route's chunks too.
 *
 * Found by the independent code-review audit of the change that added preloads: the injection was
 * wired into `buildSsrHtml`, which serves only the SYNCHRONOUS path, while `handleSsrStreaming` is
 * dispatched FIRST. So `ssrStreaming: true` turned the feature off on Node while the Cloudflare
 * worker injected on its equivalent branch — an asymmetry between two halves of one change, and
 * silent in every direction: `assetsMap` is optional, so no compile error, no runtime error, no log.
 *
 * The CHANGELOG claimed, without qualification, that a page served with SSR on carries a
 * `modulepreload` per chunk. `ssrStreaming` defaults false, so the end-to-end measurement cited
 * there ran on the path that already worked.
 *
 * Driven through `createRequestHandler` with a fake streaming RENDERER rather than a fake stage:
 * the renderer is an injected collaborator, so capturing the `htmlHead` it receives observes what
 * the real `handleSsrStreaming` passes. Asserting on a mock of the stage would prove nothing about
 * whether the stage is installed — the point the sibling `start-serves-configured-cors.test.ts`
 * makes for the same reason.
 */
import { createServer, type Server } from 'node:http'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { RequestHandlerCtx } from '../../packages/theo/src/cli/commands/start/handlers.js'
import { createRequestHandler } from '../../packages/theo/src/cli/commands/start/request-handler.js'

const HEAD = '<!doctype html><html><head><title>App</title></head><body><div id="root">'
const MAP = { '/about': ['assets/page-about.js', 'assets/shared.js'], '/': [] }

let server: Server
let port = 0
/** Every `htmlHead` the real streaming path handed to the renderer, in order. */
const headsSeen: string[] = []

beforeAll(async () => {
  const handler = createRequestHandler({
    buildCtx: (req, res, requestId, startTime): RequestHandlerCtx =>
      ({
        req,
        res,
        url: req.url ?? '/',
        requestId,
        startTime,
        clientDir: '/nonexistent-so-static-never-serves',
        custom404Html: null,
        cachedRoutes: [],
        cachedActions: [],
        cachedAgents: [],
        serverDir: '/nonexistent',
        projectRoot: '/nonexistent',
        csrfMode: 'off',
      }) as unknown as RequestHandlerCtx,
    securityHeadersConfig: {},
    corsHandler: null,
    ssrRender: null,
    ssrRenderStreaming: (_url, response, options) => {
      headsSeen.push(options?.htmlHead ?? '')
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end(`${options?.htmlHead ?? ''}<h1>streamed</h1>${options?.htmlTail ?? ''}`)
      return Promise.resolve('')
    },
    ssrStreamingEnabled: true,
    htmlHead: HEAD,
    htmlTail: '</div></body></html>',
    indexHtml: HEAD,
    custom500Html: null,
    assetsMap: MAP,
  } as unknown as Parameters<typeof createRequestHandler>[0])

  server = createServer((req, res) => {
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  port = typeof address === 'object' && address !== null ? address.port : 0
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('the streaming SSR document preloads its route chunks', () => {
  it('a lazy route carries modulepreload in the streamed head', async () => {
    headsSeen.length = 0
    const body = await (await fetch(`http://127.0.0.1:${port}/about`)).text()

    expect(headsSeen, 'the streaming renderer was never reached').toHaveLength(1)
    expect(headsSeen[0]).toContain('<link rel="modulepreload" href="/assets/page-about.js">')
    expect(headsSeen[0]).toContain('<link rel="modulepreload" href="/assets/shared.js">')
    // And it reaches the wire, not only the argument.
    expect(body).toContain('rel="modulepreload"')
  })

  it('an entry only route streams no modulepreload', async () => {
    headsSeen.length = 0
    await (await fetch(`http://127.0.0.1:${port}/`)).text()
    expect(headsSeen).toHaveLength(1)
    expect(headsSeen[0]).not.toContain('modulepreload')
  })
})
