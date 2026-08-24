/**
 * `security.cors` must be honoured by the command that serves production
 * (usetheokit/theokit#409).
 *
 * The key is a first-class, schema-validated config field with exactly one consumer: Vite's
 * `configureServer` hook. So an app that declares it works cross-origin under `theokit dev` and
 * stops working the moment `theokit start` serves it — same config, same code, no error and no
 * warning, surfacing in a browser as a blocked fetch three layers from the key that stopped being
 * read.
 *
 * Driven over a real `node:http` listener rather than by calling the handler with fakes, because
 * the defect is precisely that a pipeline which looks complete in isolation never had this stage:
 * asserting on a mock of the stage would prove nothing about whether it is installed.
 */
import { createServer, type Server } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { RequestHandlerCtx } from '../../packages/theo/src/cli/commands/start/handlers.js'
import { createRequestHandler } from '../../packages/theo/src/cli/commands/start/request-handler.js'
import { createCorsHandler } from '../../packages/theo/src/server/http/cors.js'
import { compilePattern, type ServerRouteNode } from '../../packages/theo/src/server/scan/match.js'
import { createProductionLoader } from '../../packages/theo/src/server/scan/module-loader.js'

const ALLOWED = 'https://other.example'
const PROBE_ROUTE = `
export const GET = { handler: () => ({ ok: true }) }
`

let server: Server | undefined
let origin: string

beforeAll(async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'tk409-'))
  const routeFile = join(projectRoot, 'probe.route.mjs')
  await writeFile(routeFile, PROBE_ROUTE, 'utf8')

  const { pattern, paramNames } = compilePattern('/api/probe')
  const routes: ServerRouteNode[] = [
    { filePath: routeFile, routePath: '/api/probe', pattern, paramNames, methods: ['GET'] },
  ]
  const loadModule = createProductionLoader()

  server = createServer(
    createRequestHandler({
      buildCtx: (req, res, requestId, startTime): RequestHandlerCtx => ({
        req,
        res,
        url: req.url ?? '/',
        requestId,
        startTime,
        clientDir: projectRoot,
        custom404Html: null,
        cachedRoutes: routes,
        cachedActions: [],
        cachedAgents: [],
        loadModule,
        serverDir: projectRoot,
        projectRoot,
        controllersDistDir: undefined,
        pluginRunner: undefined,
        transformer: undefined,
        csrfMode: 'strict',
        disallowed: undefined,
        rateLimiter: null,
      }),
      securityHeadersConfig: {},
      corsHandler: createCorsHandler({ origins: ALLOWED, credentials: false, maxAge: 600 }),
      ssrRender: null,
      ssrRenderStreaming: null,
      ssrStreamingEnabled: false,
      htmlHead: '',
      htmlTail: '',
      indexHtml: '<!doctype html><html></html>',
      custom500Html: null,
    }),
  )
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (server === undefined) return resolve()
    server.close(() => resolve())
  })
})

describe('theokit start honours security.cors (#409)', () => {
  it('answers a preflight from a configured origin', async () => {
    const response = await fetch(`${origin}/api/probe`, {
      method: 'OPTIONS',
      headers: { origin: ALLOWED, 'access-control-request-method': 'GET' },
    })

    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect(response.headers.get('access-control-allow-methods')).toContain('GET')
  })

  it('puts the header on an ordinary response too, not only on the preflight', async () => {
    // A preflight that passes and a GET that carries no header is the shape that looks configured
    // and still fails in a browser.
    const response = await fetch(`${origin}/api/probe`, { headers: { origin: ALLOWED } })

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED)
  })

  it('refuses a preflight from an origin the app did not configure', async () => {
    const response = await fetch(`${origin}/api/probe`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    })

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
