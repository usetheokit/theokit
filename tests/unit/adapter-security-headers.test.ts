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

async function driveCloudflare(headers?: SecurityHeadersConfig): Promise<Headers> {
  const mod = await loadEntry(
    renderCloudflareWorkerEntry({ ssrStreaming: false, securityHeaders: headers }),
  )
  const worker = mod.default as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }
  return (await worker.fetch(new Request(API_URL), {}, {})).headers
}

async function driveNetlify(headers?: SecurityHeadersConfig): Promise<Headers> {
  const mod = await loadEntry(renderNetlifyFunction({ securityHeaders: headers }))
  const fn = mod.default as (r: Request, c: unknown) => Promise<Response>
  return (await fn(new Request(API_URL), {})).headers
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
    await loadEntry(renderBunEntry(3000, { securityHeaders: headers }))
  } finally {
    process.env.NODE_ENV = previousEnv
  }
  if (!fetchHandler) throw new Error('the Bun entry never called Bun.serve')
  return fetchHandler
}

async function driveBun(headers?: SecurityHeadersConfig): Promise<Headers> {
  const fetchHandler = await loadBunEntry(headers)
  return (await fetchHandler(new Request(API_URL))).headers
}

async function driveDeno(headers?: SecurityHeadersConfig): Promise<Headers> {
  let handler: ((r: Request) => Promise<Response>) | undefined
  ;(globalThis as Record<string, unknown>).Deno = {
    env: { get: () => undefined },
    cwd: () => root,
    serve: (_o: unknown, h: (r: Request) => Promise<Response>) => {
      handler = h
    },
  }
  const mod = await loadEntry(renderDenoEntry(3000, { securityHeaders: headers }))
  expect(mod).toBeDefined()
  if (!handler) throw new Error('the Deno entry never called Deno.serve')
  return (await handler(new Request(API_URL))).headers
}

async function driveVercel(headers?: SecurityHeadersConfig): Promise<Headers> {
  const mod = await loadEntry(renderVercelFunctionEntry({ securityHeaders: headers }))
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
    { url: '/api/hello', method: 'GET', headers: { host: 'app.example.test' } },
    nodeRes,
  )
  return written
}

async function driveAwsLambda(headers?: SecurityHeadersConfig): Promise<Headers> {
  const mod = await loadEntry(renderAwsLambdaEntry({ securityHeaders: headers }))
  const handler = mod.handler as (e: unknown) => Promise<{ headers: Record<string, string> }>
  const result = await handler({
    version: '2.0',
    requestContext: { http: { method: 'GET', path: '/api/hello' } },
    headers: { host: 'app.example.test' },
  })
  return new Headers(result.headers)
}

const TARGETS: Record<string, (h?: SecurityHeadersConfig) => Promise<Headers>> = {
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
      documentServedByPlatform: false,
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
        documentServedByPlatform: false,
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
      documentServedByPlatform: false,
    })

    expect(off).not.toContain('Strict-Transport-Security')
    expect(off).not.toContain('Content-Security-Policy')
    // With no CSP there is no nonce paragraph to print either.
    expect(off).not.toContain('no nonce')
    expect(off).toContain('X-Frame-Options')
  })

  it('a target whose document the platform serves is named, not implied', () => {
    const message = describeDeployedSecurityHeaders({
      target: 'vercel',
      securityHeaders: undefined,
      mintsNonce: false,
      documentServedByPlatform: true,
    })

    expect(message).toContain('does NOT pass through this handler')
    expect(message).toContain('#412')
  })
})

describe('the served HTML document, where the handler serves it', () => {
  it('bun puts the baseline on the page it serves itself', async () => {
    // Bun is the one Web target whose own handler answers a non-API path, so it
    // is the one target where "a page carries the headers" is observable here at
    // all. On the other five the document comes from a platform static host
    // (usetheokit/theokit#412).
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
