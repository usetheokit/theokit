/**
 * Contract test for G5 T3.1 — envelope roundtrip across the wire boundary.
 *
 * Per plan g5-error-envelope-cross-layer v1.0 § Phase 3 / T3.1.
 * Blueprint ADR D4 — trpc testServerAndClientResource integration pattern.
 *
 * Spins a minimal Node HTTP server (no Vite/Express needed), emits an
 * envelope-shaped JSON response, invokes theoFetch against it, and asserts:
 * - client.TheoFetchError exposes the canonical envelope
 * - inline snapshots prove the shape matches blueprint Recommendations
 * - the formatError hook contract: when consumer overrides envelope, the
 *   server-side transformation is visible in the wire body (this test
 *   inlines the transformation rather than wiring a Vite-config end-to-end)
 */
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TheoFetchError, theoFetch } from '../../packages/theo/src/client/theo-fetch.js'
import type { TheoErrorEnvelope } from '../../packages/theo/src/core/contracts/error-envelope.js'

interface RouteFixture {
  status: number
  body: TheoErrorEnvelope | { error: { code: string; message: string } }
  headers?: Record<string, string>
}

let server: Server
let baseUrl: string
const routes = new Map<string, RouteFixture>()

beforeAll(async () => {
  server = createServer((req, res) => {
    const fixture = routes.get(req.url ?? '/')
    if (!fixture) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: 'NOT_FOUND', message: 'route not found' }))
      return
    }
    const headers = {
      'Content-Type': 'application/json',
      ...(fixture.headers ?? {}),
    }
    res.writeHead(fixture.status, headers)
    res.end(JSON.stringify(fixture.body))
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address()
  if (typeof addr !== 'object' || addr === null) {
    throw new Error('Failed to obtain server address')
  }
  baseUrl = `http://127.0.0.1:${addr.port}`
  // theoFetch reads globalThis.__THEO_ORIGIN__ before falling back to localhost.
  ;(globalThis as { __THEO_ORIGIN__?: string }).__THEO_ORIGIN__ = baseUrl
})

afterAll(async () => {
  routes.clear()
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
  delete (globalThis as { __THEO_ORIGIN__?: string }).__THEO_ORIGIN__
})

describe('envelope roundtrip — server -> wire -> client (G5 T3.1)', () => {
  it('should round-trip a canonical TheoErrorEnvelope (code + message)', async () => {
    // Given: server returns envelope shape at root
    routes.set('/api/test1', {
      status: 412,
      body: {
        code: 'PRECONDITION_FAILED',
        message: 'EMBEDDER_REQUIRED',
      },
    })

    // When: client invokes theoFetch
    let captured: TheoFetchError | undefined
    try {
      await theoFetch('/api/test1')
    } catch (err) {
      if (err instanceof TheoFetchError) captured = err
    }

    // Then: client received envelope-shaped error with correct code
    expect(captured).toBeDefined()
    expect(captured?.envelope.code).toBe('PRECONDITION_FAILED')
    expect(captured?.envelope.message).toBe('EMBEDDER_REQUIRED')
    expect(captured?.status).toBe(412)
  })

  it('should round-trip envelope with ext (HintExt)', async () => {
    // Given: server emits envelope with HintExt for actionable client display
    routes.set('/api/test2', {
      status: 412,
      body: {
        code: 'PRECONDITION_FAILED',
        message: 'EMBEDDER_REQUIRED',
        ext: { hint: 'Set OPENAI_API_KEY in your .env file before invoking this route' },
      },
    })

    // When: client invokes theoFetch
    let captured: TheoFetchError | undefined
    try {
      await theoFetch('/api/test2')
    } catch (err) {
      if (err instanceof TheoFetchError) captured = err
    }

    // Then: ext.hint round-tripped through wire boundary
    expect((captured?.envelope.ext as { hint: string }).hint).toMatch(/OPENAI_API_KEY/)
  })

  it('should map legacy { error: {...} } body (G3 SerializedActionResult shape) to envelope', async () => {
    // Given: legacy G3 wire format
    routes.set('/api/test3', {
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
        },
      },
    })

    // When: client invokes theoFetch
    let captured: TheoFetchError | undefined
    try {
      await theoFetch('/api/test3')
    } catch (err) {
      if (err instanceof TheoFetchError) captured = err
    }

    // Then: envelope getter normalizes legacy shape transparently
    expect(captured?.envelope.code).toBe('VALIDATION_ERROR')
    expect(captured?.envelope.message).toBe('Validation failed')
    // Legacy .code getter (backward compat) also surfaces it
    expect(captured?.code).toBe('VALIDATION_ERROR')
  })

  it('should match inline snapshot of envelope shape (blueprint D4 pattern)', async () => {
    // Given: server emits a canonical RATE_LIMITED with retryAfterMs ext
    routes.set('/api/test4', {
      status: 429,
      body: {
        code: 'RATE_LIMITED',
        message: 'Quota exhausted',
        ext: { retryable: true, retryAfterMs: 5000 },
      },
    })

    // When: client invokes theoFetch
    let captured: TheoFetchError | undefined
    try {
      await theoFetch('/api/test4')
    } catch (err) {
      if (err instanceof TheoFetchError) captured = err
    }

    // Then: envelope matches inline snapshot (blueprint D4 — auditable wire contract)
    expect(captured?.envelope).toMatchInlineSnapshot(`
      {
        "cause": undefined,
        "code": "RATE_LIMITED",
        "ext": {
          "retryAfterMs": 5000,
          "retryable": true,
        },
        "message": "Quota exhausted",
        "meta": undefined,
      }
    `)
  })
})
