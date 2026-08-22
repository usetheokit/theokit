/**
 * B-026 — the six Web deploy targets put the configured security headers on a
 * real response, and the proof is the response.
 *
 * `theokit start` applied the baseline to everything it wrote
 * (`cli/commands/start/request-handler.ts:241`) and not one of the six
 * Web-standards adapters applied any, so a deployed page carried no CSP, no
 * `X-Frame-Options`, no HSTS and no `nosniff` while the same page under
 * `theokit start` carried all four (usetheokit/theokit#410,
 * GHSA-87qq-fgcr-384x — whose other half, the rate limiter, is untouched).
 *
 * **This file does not grep the generated entry.** It writes each emitted entry
 * to disk, imports it, drives a request through the handler it exports, and
 * reads the headers off the `Response` that comes back. That standard is not
 * pedantry: `adapter-streaming-contract.test.ts` says in its own header that a
 * suite made only of source greps is why the shim buffered whole responses for
 * as long as it did, and `adapter-entry-parses.test.ts` exists because twelve
 * such suites passed against a Vercel entry that was a `SyntaxError`.
 *
 * ## What is real here and what is a stand-in
 *
 * Real: the emitted entry, verbatim; the `Response` object; `createWebShim`;
 * `buildSecurityHeaders`; `withSecurityHeaders`; the header names and values a
 * client would receive.
 *
 * Stand-in: the route pipeline behind `executeRoute` (a handler that writes a
 * short JSON body through the real shim), and the runtime globals each target
 * expects (`Bun`, `Deno`, a Node `req`/`res` pair for Vercel, an API Gateway v2
 * event for Lambda). None of them touch the headers under test.
 *
 * Not covered, and stated rather than implied: the platform in front of the
 * handler. On four targets the HTML document is served by a static host this
 * build does not configure, so these headers reach `/api/*` and not the page
 * (usetheokit/theokit#412). Nothing here can observe that, and nothing here
 * claims to.
 */
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import {
  buildSecurityHeaders,
  describeDeployedSecurityHeaders,
  generateNonce,
  withSecurityHeaders,
} from '../../packages/theo/src/adapters/security-headers.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'
import { createWebShim } from '../../packages/theo/src/adapters/web-shim.js'
import type { SecurityHeadersConfig } from '../../packages/theo/src/core/contracts/security-headers.js'
// The real handlers, not stubs: what these tests exercise is the shipped behaviour — the trace
// precedence, and the CORS matching including that an unconfigured origin gets nothing.
import { createCorsWebHandler } from '../../packages/theo/src/server/http/cors.js'
import {
  extractTraceIdFromRequest,
  TRACE_HEADER,
} from '../../packages/theo/src/server/http/trace-context.js'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface HarnessBridge {
  scanServerRoutes: () => unknown[]
  scanWebSocketRoutes: () => unknown[]
  matchRoute: (pathname: string, routes: unknown[]) => unknown
  compilePattern: (routePath: string) => { pattern: RegExp; paramNames: string[] }
  createProductionLoader: () => () => Record<string, unknown>
  executeRoute: (args: { res: ShimLikeResponse }) => Promise<void>
  createWebShim: typeof createWebShim
  buildSecurityHeaders: typeof buildSecurityHeaders
  generateNonce: typeof generateNonce
  withSecurityHeaders: typeof withSecurityHeaders
  createBunWsBridge: () => unknown
  createCloudflareWsBridge: () => unknown
  createDenoWsBridge: () => unknown
  renderStreamingWeb: (request: Request, options: { nonce?: string }) => Response
  // #410 — every entry now resolves the caller's trace id instead of minting one.
  extractTraceIdFromRequest: typeof extractTraceIdFromRequest
  TRACE_HEADER: string
  // #409 — every entry now builds a CORS handler from a baked literal.
  createCorsWebHandler: typeof createCorsWebHandler
}

/** The subset of the shim's `res` this file's fake handler writes through. */
interface ShimLikeResponse {
  writeHead: (status: number, headers: Record<string, string>) => void
  end: (chunk?: string) => void
  setHeader: (key: string, value: string) => void
}

/**
 * The names every emitted entry imports, re-exported from a global the test
 * populates. The entries' bare specifiers (`theokit/server`,
 * `theokit/adapters/*`, `npm:theokit/*`, `/@theo/entry-server`) are rewritten to
 * this one module, so nothing here depends on a built `dist/`.
 */
const STUB_SOURCE = `
const b = () => globalThis.__THEO_ADAPTER_HARNESS__
export const scanServerRoutes = (...a) => b().scanServerRoutes(...a)
export const scanWebSocketRoutes = (...a) => b().scanWebSocketRoutes(...a)
export const matchRoute = (...a) => b().matchRoute(...a)
export const compilePattern = (...a) => b().compilePattern(...a)
export const createProductionLoader = (...a) => b().createProductionLoader(...a)
export const executeRoute = (...a) => b().executeRoute(...a)
export const createWebShim = (...a) => b().createWebShim(...a)
export const buildSecurityHeaders = (...a) => b().buildSecurityHeaders(...a)
export const generateNonce = (...a) => b().generateNonce(...a)
export const withSecurityHeaders = (...a) => b().withSecurityHeaders(...a)
export const createBunWsBridge = (...a) => b().createBunWsBridge(...a)
export const createCloudflareWsBridge = (...a) => b().createCloudflareWsBridge(...a)
export const createDenoWsBridge = (...a) => b().createDenoWsBridge(...a)
export const renderStreamingWeb = (...a) => b().renderStreamingWeb(...a)
export const extractTraceIdFromRequest = (...a) => b().extractTraceIdFromRequest(...a)
export const TRACE_HEADER = b().TRACE_HEADER
export const createCorsWebHandler = (...a) => b().createCorsWebHandler(...a)
// #367 — the entries now route the agent prefix. This harness is about the security baseline, so
// the agent path is stubbed to never match: \`scanAgents\` answering [] makes every request fall
// through to the route table, which is what these assertions are measuring.
export const mountAgent = async () => new Response('agent')
export const resolveProvider = () => ({ apiKey: 'sk-test' })
export const scanAgents = () => []
`

/** The nonce the streaming renderer was handed, so the header can be matched to it. */
let observedNonce: string | undefined

const ROUTE = { path: '/api/hello', filePath: 'server/api/hello.ts' }

const bridge: HarnessBridge = {
  scanServerRoutes: () => [ROUTE],
  scanWebSocketRoutes: () => [],
  matchRoute: (pathname) => (pathname === '/api/hello' ? { route: ROUTE, params: {} } : null),
  // #369 — the Cloudflare worker compiles its baked route table at module scope now, instead of
  // scanning a directory it cannot read. The stub answers with the shape `matchRoute` consumes.
  compilePattern: (routePath: string) => ({
    pattern: new RegExp(`^${routePath}$`, 'u'),
    paramNames: [],
  }),
  createProductionLoader: () => () => ({}),
  executeRoute: ({ res }) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return Promise.resolve()
  },
  createWebShim,
  buildSecurityHeaders,
  generateNonce,
  withSecurityHeaders,
  // The real resolver, not a stub: the point of driving the emitted artifact is that the
  // trace precedence (traceparent → validated x-request-id → fresh UUID) is the shipped one.
  extractTraceIdFromRequest,
  TRACE_HEADER,
  createCorsWebHandler,
  createBunWsBridge: () => ({ open: () => {}, message: () => {}, close: () => {} }),
  createCloudflareWsBridge: () => ({ handle: () => new Response(null, { status: 101 }) }),
  createDenoWsBridge: () => ({ handle: () => new Response(null, { status: 101 }) }),
  renderStreamingWeb: (_request, options) => {
    observedNonce = options.nonce
    return new Response('<!doctype html><html><body>streamed</body></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  },
}

let root: string
let stubUrl: string
let counter = 0

/**
 * Write an emitted entry next to the stub and import it for real.
 *
 * Only `node:` specifiers survive the rewrite — they are genuine builtins and
 * the entries use them for what they say (`randomUUID`, `existsSync`, `resolve`).
 */
async function loadEntry(source: string): Promise<Record<string, unknown>> {
  counter += 1
  const file = join(root, `entry-${String(counter)}.mjs`)
  writeFileSync(
    file,
    source.replace(/^(\s*import[^\n]*?from\s+)'(?!node:)[^']*'/gm, `$1'${stubUrl}'`),
  )
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-adapter-headers-'))
  writeFileSync(join(root, 'theo-stub.mjs'), STUB_SOURCE)
  stubUrl = './theo-stub.mjs'
  ;(globalThis as Record<string, unknown>).__THEO_ADAPTER_HARNESS__ = bridge
})

afterAll(() => {
  delete (globalThis as Record<string, unknown>).__THEO_ADAPTER_HARNESS__
})

// ---------------------------------------------------------------------------
// Per-target drivers — each returns the headers a client would receive
// ---------------------------------------------------------------------------

const API_URL = 'https://app.example.test/api/hello'

/**
 * What a driver may vary about the request and the build.
 *
 * Added for #409: CORS is the first concern here whose answer depends on what the CALLER sent, so
 * a driver that could only vary the build could not observe it.
 */
interface DriveOptions {
  /** Baked into the emitted entry. */
  cors?: CorsOptions
  /** Sent by the caller — an `origin`, a preflight's `access-control-request-method`. */
  requestHeaders?: HeadersInit
  /** The request method, for a preflight. */
  method?: string
}

type CorsOptions = Parameters<typeof renderNetlifyFunction>[0] extends infer O
  ? O extends { cors?: infer C }
    ? C
    : never
  : never

function req(o: DriveOptions | undefined): Request {
  return new Request(API_URL, { method: o?.method ?? 'GET', headers: o?.requestHeaders })
}

async function driveCloudflare(
  headers?: SecurityHeadersConfig,
  o?: DriveOptions,
): Promise<Headers> {
  const mod = await loadEntry(
    renderCloudflareWorkerEntry({ ssrStreaming: false, securityHeaders: headers, cors: o?.cors }),
  )
  const worker = mod.default as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }
  return (await worker.fetch(req(o), {}, {})).headers
}

async function driveNetlify(headers?: SecurityHeadersConfig, o?: DriveOptions): Promise<Headers> {
  const mod = await loadEntry(renderNetlifyFunction({ securityHeaders: headers, cors: o?.cors }))
  const fn = mod.default as (r: Request, c: unknown) => Promise<Response>
  // `DriveOptions.requestHeaders` exists for #410 and #409: an id the caller sends and an `origin`
  // the caller sends are both unobservable from a request that sends neither.
  return (await fn(req(o), {})).headers
}

class BunFile extends Blob {
  exists(): Promise<boolean> {
    return Promise.resolve(true)
  }
}

/**
 * Load a Bun entry and return the `fetch` it handed `Bun.serve`.
 *
 * The entry enforces its own preconditions before anything else — EC-1's
 * `NODE_ENV !== 'production'` guard and the Bun >= 1.1 version check both call
 * `process.exit(1)` — so both have to hold for the module to finish evaluating.
 * Satisfying them is part of driving the real artifact, not a workaround.
 */
async function loadBunEntry(
  headers?: SecurityHeadersConfig,
  cors?: CorsOptions,
): Promise<(r: Request) => Promise<Response>> {
  let fetchHandler: ((r: Request) => Promise<Response>) | undefined
  ;(globalThis as Record<string, unknown>).Bun = {
    version: '1.2.0',
    serve: (o: { fetch: (r: Request) => Promise<Response> }) => {
      fetchHandler = o.fetch
    },
    file: (p: string) => new BunFile([readFileSync(p)], { type: 'text/html' }),
  }
  const previousEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    await loadEntry(renderBunEntry(3000, { securityHeaders: headers, cors }))
  } finally {
    process.env.NODE_ENV = previousEnv
  }
  if (!fetchHandler) throw new Error('the Bun entry never called Bun.serve')
  return fetchHandler
}

async function driveBun(headers?: SecurityHeadersConfig, o?: DriveOptions): Promise<Headers> {
  const fetchHandler = await loadBunEntry(headers, o?.cors)
  return (await fetchHandler(req(o))).headers
}

async function driveDeno(headers?: SecurityHeadersConfig, o?: DriveOptions): Promise<Headers> {
  let handler: ((r: Request) => Promise<Response>) | undefined
  ;(globalThis as Record<string, unknown>).Deno = {
    env: { get: () => undefined },
    cwd: () => root,
    serve: (_o: unknown, h: (r: Request) => Promise<Response>) => {
      handler = h
    },
  }
  const mod = await loadEntry(renderDenoEntry(3000, { securityHeaders: headers, cors: o?.cors }))
  expect(mod).toBeDefined()
  if (!handler) throw new Error('the Deno entry never called Deno.serve')
  return (await handler(req(o))).headers
}

async function driveVercel(headers?: SecurityHeadersConfig, o?: DriveOptions): Promise<Headers> {
  const mod = await loadEntry(
    renderVercelFunctionEntry({ securityHeaders: headers, cors: o?.cors }),
  )
  const handler = mod.default as (req: unknown, res: unknown) => Promise<void>
  const written = new Headers()
  const nodeRes = {
    writeHead: (_s: number, h: Record<string, string>) => {
      for (const [k, v] of Object.entries(h)) written.set(k, v)
    },
    write: () => true,
    end: () => {},
    off: () => {},
    once: () => {},
    destroy: () => {},
  }
  await handler(
    {
      url: '/api/hello',
      method: o?.method ?? 'GET',
      headers: { host: 'app.example.test', ...Object.fromEntries(new Headers(o?.requestHeaders)) },
    },
    nodeRes,
  )
  return written
}

async function driveAwsLambda(headers?: SecurityHeadersConfig, o?: DriveOptions): Promise<Headers> {
  const mod = await loadEntry(renderAwsLambdaEntry({ securityHeaders: headers, cors: o?.cors }))
  const handler = mod.handler as (e: unknown) => Promise<{ headers: Record<string, string> }>
  const result = await handler({
    version: '2.0',
    requestContext: { http: { method: o?.method ?? 'GET', path: '/api/hello' } },
    headers: { host: 'app.example.test', ...Object.fromEntries(new Headers(o?.requestHeaders)) },
  })
  return new Headers(result.headers)
}

const TARGETS: Record<string, (h?: SecurityHeadersConfig, o?: DriveOptions) => Promise<Headers>> = {
  cloudflare: driveCloudflare,
  vercel: driveVercel,
  netlify: driveNetlify,
  bun: driveBun,
  'deno-deploy': driveDeno,
  'aws-lambda': driveAwsLambda,
}

// ---------------------------------------------------------------------------

describe('a real response from every Web deploy target carries the security baseline', () => {
  // What `theokit start` puts on a response for an app that declares no
  // `security.headers` block: `cli/commands/start/index.ts` passes `{}` and
  // `request-handler.ts` calls this same function with `{ production: true }`.
  const baseline = buildSecurityHeaders({}, { production: true })

  for (const [target, drive] of Object.entries(TARGETS)) {
    it(`${target} returns a response carrying every default header`, async () => {
      const headers = await drive()

      for (const [key, value] of Object.entries(baseline)) {
        expect(headers.get(key), `${target} is missing ${key}`).toBe(value)
      }
    })

    it(`${target} carries the four headers B-026 measured as absent`, async () => {
      const headers = await drive()

      expect(headers.get('Content-Security-Policy')).toContain("default-src 'self'")
      expect(headers.get('X-Frame-Options')).toBe('DENY')
      expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(headers.get('Strict-Transport-Security')).toContain('max-age=')
    })

    it(`${target} carries the configured values, not only the defaults`, async () => {
      // Proves the block actually travels from `theo.config.ts` into the
      // deployed artifact. Defaults alone would pass the tests above even if the
      // literal were dropped on the way.
      const headers = await drive({
        frameOptions: 'SAMEORIGIN',
        cspMode: 'report-only',
        referrerPolicy: 'no-referrer',
        hsts: false,
      })

      expect(headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
      expect(headers.get('Referrer-Policy')).toBe('no-referrer')
      expect(headers.get('Content-Security-Policy-Report-Only')).toContain("default-src 'self'")
      expect(headers.get('Content-Security-Policy')).toBeNull()
      expect(headers.get('Strict-Transport-Security')).toBeNull()
    })
  }
})

describe('a real response from every Web deploy target carries a correlation id (#410)', () => {
  // Every entry minted a fresh `randomUUID()` and set NO correlation header on a success path,
  // while both Node paths resolve the incoming `traceparent` / `x-request-id` and echo the result
  // under both names. A trace crossing into a deployed function started over, and the response
  // carried nothing to correlate against — so a production failure could not be tied back to the
  // client that caused it, which is the one job the id has.
  for (const [target, drive] of Object.entries(TARGETS)) {
    it(`${target} echoes the id under both names`, async () => {
      const headers = await drive()

      const requestId = headers.get('x-request-id')
      expect(requestId, `${target} sent no x-request-id`).toBeTruthy()
      // Both names, matching `theokit start`: `x-request-id` is what existing consumers read,
      // `x-trace-id` is the canonical one. One without the other is a half-migration.
      expect(headers.get('x-trace-id'), `${target} sent no x-trace-id`).toBe(requestId)
    })
  }
})

describe("a caller's own trace id survives the trip (#410)", () => {
  it('echoes the id the client sent, instead of a fresh one', async () => {
    const sent = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

    const headers = await driveNetlify(undefined, { requestHeaders: { 'x-request-id': sent } })

    expect(headers.get('x-request-id')).toBe(sent)
    expect(headers.get('x-trace-id')).toBe(sent)
  })

  it('prefers a W3C traceparent over the caller-controlled x-request-id', async () => {
    // Precedence is the shipped resolver's, not this test's: `traceparent` is the standard and
    // `x-request-id` is validated before it is trusted because it ends up in logs.
    const headers = await driveNetlify(undefined, {
      requestHeaders: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        'x-request-id': '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      },
    })

    expect(headers.get('x-request-id')).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })
})

describe('a real response from every Web deploy target serves the configured CORS (#409)', () => {
  // `security.cors` reached exactly one consumer — Vite's `configureServer` hook — so an app that
  // worked cross-origin under `theokit dev` stopped working on every deploy target, with no error
  // and no warning. Driven per target rather than once, because the entries are six independent
  // emitters and a test covering one would pass on five that dropped it.
  const ALLOWED = 'https://other.example'
  const CORS = { origins: ALLOWED, credentials: false, maxAge: 600 } as unknown as CorsOptions

  for (const [target, drive] of Object.entries(TARGETS)) {
    it(`${target} puts the header on an ordinary response`, async () => {
      const headers = await drive(undefined, { cors: CORS, requestHeaders: { origin: ALLOWED } })

      expect(headers.get('access-control-allow-origin'), `${target} dropped it`).toBe(ALLOWED)
    })

    it(`${target} answers a preflight before the router sees it`, async () => {
      const headers = await drive(undefined, {
        cors: CORS,
        method: 'OPTIONS',
        requestHeaders: { origin: ALLOWED, 'access-control-request-method': 'GET' },
      })

      expect(headers.get('access-control-allow-origin')).toBe(ALLOWED)
      expect(headers.get('access-control-allow-methods')).toContain('GET')
    })

    it(`${target} gives an unconfigured origin nothing`, async () => {
      // The counter-proof, and the one that matters: a fix that echoed every origin would pass the
      // two above and hand the app a wildcard nobody asked for.
      const headers = await drive(undefined, {
        cors: CORS,
        requestHeaders: { origin: 'https://evil.example' },
      })

      expect(headers.get('access-control-allow-origin')).toBeNull()
    })

    it(`${target} sends no CORS header when the app declared none`, async () => {
      // Absence still means absence. An entry that defaulted to permissive would be a worse bug
      // than the one being fixed.
      const headers = await drive(undefined, { requestHeaders: { origin: ALLOWED } })

      expect(headers.get('access-control-allow-origin')).toBeNull()
    })
  }
})

describe('the deployed baseline is the same one theokit start applies', () => {
  it('every target agrees with buildSecurityHeaders on the same config', async () => {
    const config: SecurityHeadersConfig = { frameOptions: 'SAMEORIGIN', referrerPolicy: 'origin' }
    const expected = buildSecurityHeaders(config, { production: true })

    for (const [target, drive] of Object.entries(TARGETS)) {
      const headers = await drive(config)
      for (const [key, value] of Object.entries(expected)) {
        expect(headers.get(key), `${target} disagrees on ${key}`).toBe(value)
      }
    }
  })
})

describe('a handler that set its own header keeps it', () => {
  it('does not overrule a Content-Security-Policy the route chose', async () => {
    // Parity with `theokit start`, which sets the baseline BEFORE the route runs
    // so `res.setHeader` wins by Node convention. On a Web target the response
    // arrives already built, so the equivalent is to skip what is already there.
    const original = bridge.executeRoute
    bridge.executeRoute = ({ res }) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-security-policy': "default-src 'none'",
      })
      res.end('{}')
      return Promise.resolve()
    }
    try {
      const headers = await driveNetlify()
      expect(headers.get('content-security-policy')).toBe("default-src 'none'")
      // The rest of the baseline still lands.
      expect(headers.get('X-Frame-Options')).toBe('DENY')
    } finally {
      bridge.executeRoute = original
    }
  })
})

describe('the per-request nonce: reachable on exactly one deploy path', () => {
  it('the streamed Cloudflare document gets a nonce, in the header and in the renderer', async () => {
    observedNonce = undefined
    const mod = await loadEntry(
      renderCloudflareWorkerEntry({
        ssrStreaming: true,
        htmlHead: '<!doctype html><html><head></head><body><div id="root">',
        htmlTail: '</div></body></html>',
      }),
    )
    const worker = mod.default as {
      fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>
    }

    const response = await worker.fetch(new Request('https://app.example.test/'), {}, {})
    const csp = response.headers.get('Content-Security-Policy')

    expect(observedNonce, 'renderStreamingWeb was handed no nonce').toBeTruthy()
    expect(csp).toContain(`'nonce-${String(observedNonce)}'`)
    // EC-3: a one-shot CSP must not be cached and re-served against different
    // inline scripts.
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('two requests to the streamed worker get different nonces', async () => {
    const mod = await loadEntry(
      renderCloudflareWorkerEntry({ ssrStreaming: true, htmlHead: '<html>', htmlTail: '</html>' }),
    )
    const worker = mod.default as {
      fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>
    }

    const first = await worker.fetch(new Request('https://app.example.test/a'), {}, {})
    const second = await worker.fetch(new Request('https://app.example.test/b'), {}, {})

    expect(first.headers.get('Content-Security-Policy')).not.toBe(
      second.headers.get('Content-Security-Policy'),
    )
  })

  it('every other target serves a nonce-less CSP, and does not pretend otherwise', async () => {
    for (const [target, drive] of Object.entries(TARGETS)) {
      const headers = await drive()
      expect(headers.get('Content-Security-Policy'), `${target} minted a nonce`).not.toContain(
        "'nonce-",
      )
    }
  })

  it('the build says so by name instead of letting it be discovered in production', () => {
    const message = describeDeployedSecurityHeaders({
      target: 'bun',
      securityHeaders: undefined,
      mintsNonce: false,
      documentHeaders: 'handler',
    })

    expect(message).toContain('bun')
    expect(message).toContain('no nonce')
    expect(message).toContain('theokit start')
    // An instruction, not an observation.
    expect(message).toMatch(/Move inline scripts|report-only/)
  })

  it('the streamed worker is told nothing about a nonce it does mint', () => {
    expect(
      describeDeployedSecurityHeaders({
        target: 'cloudflare',
        securityHeaders: undefined,
        mintsNonce: true,
        documentHeaders: 'handler',
      }),
    ).not.toContain('no nonce')
  })

  it('names the headers the entry will actually carry, not a list beside it', () => {
    // A build that announced `HSTS` while the config had switched it off would
    // be a wrong statement in the one place an operator reads for reassurance.
    const off = describeDeployedSecurityHeaders({
      target: 'vercel',
      securityHeaders: { hsts: false, csp: false, permissionsPolicy: false },
      mintsNonce: false,
      documentHeaders: 'handler',
    })

    expect(off).not.toContain('Strict-Transport-Security')
    expect(off).not.toContain('Content-Security-Policy')
    // With no CSP there is no nonce paragraph to print either.
    expect(off).not.toContain('no nonce')
    expect(off).toContain('X-Frame-Options')
  })

  it('a target whose document nobody here can configure is named, not implied', () => {
    const message = describeDeployedSecurityHeaders({
      target: 'aws-lambda',
      securityHeaders: undefined,
      mintsNonce: false,
      documentHeaders: 'platform-unmanaged',
    })

    expect(message).toContain('does NOT pass through this handler')
    expect(message).toContain('#412')
  })

  it('a target whose document THIS build configures is not told to go configure it', () => {
    // This assertion moved with the truth. `vercel` used to print the message above; the build now
    // emits the header rules its platform reads, so repeating the instruction sends an operator to
    // do work that is already done — and a stale limitation reads exactly like a current one.
    const message = describeDeployedSecurityHeaders({
      target: 'vercel',
      securityHeaders: undefined,
      mintsNonce: false,
      documentHeaders: 'platform-configured',
    })

    expect(message).not.toContain('does NOT pass through this handler')
    expect(message).toMatch(/config this build emits/)
    // And it still refuses to overclaim: no deployed response has been read back.
    expect(message).toMatch(/not verified by a deploy/i)
  })
})

describe('the served HTML document, where the handler serves it', () => {
  it('bun puts the baseline on the page it serves itself', async () => {
    // Bun answers a non-API path from its own handler. Cloudflare now does too (#412), and has
    // its own assertions in `cloudflare-serves-the-document.test.ts`; on the remaining four the
    // document comes from a platform static host, which is why this is asserted here and not for
    // all six.
    const clientDir = join(root, 'bun-app', '.theokit', 'client')
    mkdirSync(clientDir, { recursive: true })
    writeFileSync(join(clientDir, 'index.html'), '<!doctype html><html><body>page</body></html>')

    const previousCwd = process.cwd()
    process.chdir(join(root, 'bun-app'))
    try {
      // The entry reads `process.cwd()` at module scope, so the chdir has to
      // precede the import — that is why this test loads its own copy.
      const fetchHandler = await loadBunEntry()

      const response = await fetchHandler(new Request('https://app.example.test/'))

      expect(await response.text()).toContain('page')
      expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
      expect(response.headers.get('X-Frame-Options')).toBe('DENY')
      expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=')
    } finally {
      process.chdir(previousCwd)
    }
  })
})
