import { describe, it, expect, vi, afterEach } from 'vitest'
import { proxyFetch } from '../../packages/theo/src/services/index.js'

function makeMockFetch(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch
}

function captureFetch(): { fn: typeof fetch; capturedRequest?: Request } {
  const captured: { fn: typeof fetch; capturedRequest?: Request } = {
    fn: undefined as unknown as typeof fetch,
  }
  captured.fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    captured.capturedRequest = req
    return new Response('captured', { status: 200 })
  }) as unknown as typeof fetch
  return captured
}

describe('T1.3 — proxyFetch', () => {
  it('proxies happy path GET', async () => {
    const res = await proxyFetch(new Request('http://localhost/api/agent/foo'), {
      target: 'http://example.com/foo',
      customFetch: makeMockFetch(new Response('hello', { status: 200 })),
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
  })

  it('strips hop-by-hop headers on outgoing request', async () => {
    const cap = captureFetch()
    await proxyFetch(
      new Request('http://localhost/api/x', {
        headers: {
          connection: 'keep-alive',
          'keep-alive': 'timeout=5',
          'transfer-encoding': 'chunked',
          'x-keep-me': 'yes',
        },
      }),
      { target: 'http://example.com/x', customFetch: cap.fn },
    )
    const out = cap.capturedRequest!
    expect(out.headers.get('connection')).toBeNull()
    expect(out.headers.get('keep-alive')).toBeNull()
    expect(out.headers.get('transfer-encoding')).toBeNull()
    expect(out.headers.get('x-keep-me')).toBe('yes')
  })

  it('strips hop-by-hop headers on response', async () => {
    const upstream = new Response('body', {
      status: 200,
      headers: {
        connection: 'close',
        'transfer-encoding': 'chunked',
        'x-stay': 'yes',
      },
    })
    const res = await proxyFetch(new Request('http://localhost/x'), {
      target: 'http://example.com/x',
      customFetch: makeMockFetch(upstream),
    })
    expect(res.headers.get('connection')).toBeNull()
    expect(res.headers.get('transfer-encoding')).toBeNull()
    expect(res.headers.get('x-stay')).toBe('yes')
  })

  it('deletes accept-encoding on outgoing request', async () => {
    const cap = captureFetch()
    await proxyFetch(
      new Request('http://localhost/x', {
        headers: { 'accept-encoding': 'br' },
      }),
      { target: 'http://example.com/x', customFetch: cap.fn },
    )
    expect(cap.capturedRequest!.headers.get('accept-encoding')).toBeNull()
  })

  it('deletes content-encoding on response', async () => {
    const upstream = new Response('body', {
      status: 200,
      headers: { 'content-encoding': 'gzip' },
    })
    const res = await proxyFetch(new Request('http://localhost/x'), {
      target: 'http://example.com/x',
      customFetch: makeMockFetch(upstream),
    })
    expect(res.headers.get('content-encoding')).toBeNull()
  })

  it('deletes content-length on response', async () => {
    const upstream = new Response('body', {
      status: 200,
      headers: { 'content-length': '1234' },
    })
    const res = await proxyFetch(new Request('http://localhost/x'), {
      target: 'http://example.com/x',
      customFetch: makeMockFetch(upstream),
    })
    expect(res.headers.get('content-length')).toBeNull()
  })

  it('strips Set-Cookie by default', async () => {
    const upstream = new Response('body', {
      status: 200,
      headers: { 'set-cookie': 'session=abc' },
    })
    const res = await proxyFetch(new Request('http://localhost/x'), {
      target: 'http://example.com/x',
      customFetch: makeMockFetch(upstream),
    })
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('passes Set-Cookie when opted in', async () => {
    const upstream = new Response('body', {
      status: 200,
      headers: { 'set-cookie': 'session=abc' },
    })
    const res = await proxyFetch(new Request('http://localhost/x'), {
      target: 'http://example.com/x',
      passSetCookie: true,
      customFetch: makeMockFetch(upstream),
    })
    expect(res.headers.get('set-cookie')).toBe('session=abc')
  })

  it('blocks path traversal via stripBase', async () => {
    const cap = captureFetch()
    const res = await proxyFetch(new Request('http://localhost/api/agent/../escape'), {
      target: 'http://example.com',
      stripBase: '/api/agent',
      customFetch: cap.fn,
    })
    expect(res.status).toBe(400)
    expect(cap.capturedRequest).toBeUndefined()
  })

  it('strips base correctly when in scope', async () => {
    const cap = captureFetch()
    await proxyFetch(new Request('http://localhost/api/agent/foo/bar'), {
      target: 'http://example.com',
      stripBase: '/api/agent',
      customFetch: cap.fn,
    })
    expect(new URL(cap.capturedRequest!.url).pathname).toBe('/foo/bar')
  })

  it('forwards traceparent unchanged', async () => {
    const tp = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'
    const cap = captureFetch()
    await proxyFetch(
      new Request('http://localhost/x', {
        headers: { traceparent: tp },
      }),
      { target: 'http://example.com/x', customFetch: cap.fn },
    )
    expect(cap.capturedRequest!.headers.get('traceparent')).toBe(tp)
  })

  it('returns 502 on upstream connection failure', async () => {
    const failingFetch: typeof fetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const res = await proxyFetch(new Request('http://localhost/x'), {
      target: 'http://example.com/x',
      customFetch: failingFetch,
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('relays upstream 5xx status as-is', async () => {
    const res = await proxyFetch(new Request('http://localhost/x'), {
      target: 'http://example.com/x',
      customFetch: makeMockFetch(new Response('upstream err', { status: 503 })),
    })
    expect(res.status).toBe(503)
  })

  // EC-5
  it('sets Host header to target host (EC-5)', async () => {
    const cap = captureFetch()
    await proxyFetch(
      new Request('http://theokit.example.com/api/x', {
        headers: { host: 'theokit.example.com' },
      }),
      { target: 'http://localhost:8001/x', customFetch: cap.fn },
    )
    expect(cap.capturedRequest!.headers.get('host')).toBe('localhost:8001')
  })

  // EC-16
  it('does not forward body for HEAD requests (EC-16)', async () => {
    const cap = captureFetch()
    await proxyFetch(new Request('http://localhost/x', { method: 'HEAD' }), {
      target: 'http://example.com/x',
      customFetch: cap.fn,
    })
    expect(cap.capturedRequest!.body).toBeNull()
  })

  it('does not forward body for OPTIONS requests (EC-16)', async () => {
    const cap = captureFetch()
    await proxyFetch(new Request('http://localhost/x', { method: 'OPTIONS' }), {
      target: 'http://example.com/x',
      customFetch: cap.fn,
    })
    expect(cap.capturedRequest!.body).toBeNull()
  })

  // EC-17
  it('relays 304 Not Modified with empty body (EC-17)', async () => {
    const upstream = new Response(null, { status: 304 })
    const res = await proxyFetch(new Request('http://localhost/x'), {
      target: 'http://example.com/x',
      customFetch: makeMockFetch(upstream),
    })
    expect(res.status).toBe(304)
  })

  // EC-26
  it('relays 3xx redirect as-is (does not follow upstream redirects, EC-26)', async () => {
    const upstream = new Response(null, {
      status: 302,
      headers: { location: '/elsewhere' },
    })
    const res = await proxyFetch(new Request('http://localhost/x'), {
      target: 'http://example.com/x',
      customFetch: makeMockFetch(upstream),
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/elsewhere')
  })
})

/**
 * A failed upstream `fetch` reports why it failed, and the reason names the upstream: its host,
 * its port, sometimes its credentials. That description belongs in the server's log, not in the
 * 502 an external caller reads — the same rule the rest of the framework applies to an internal
 * failure's message (`core/contracts/client-safe-error.ts`).
 */
describe('proxyFetch — an unreachable upstream does not describe itself to the caller', () => {
  const INTERNAL = 'connect ECONNREFUSED 10.0.3.14:5432 (billing-db.internal)'

  function failingFetch(): typeof fetch {
    return vi.fn(async () => {
      throw new Error(INTERNAL)
    }) as unknown as typeof fetch
  }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('Given production, Then the 502 body carries no upstream detail', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = await proxyFetch(new Request('http://localhost/api/x'), {
      target: 'http://billing-db.internal/x',
      customFetch: failingFetch(),
    })

    expect(response.status).toBe(502)
    const body = await response.text()
    expect(body).not.toContain(INTERNAL)
    expect(body).not.toContain('10.0.3.14')
    expect(body).toContain('SERVICE_UNAVAILABLE')
  })

  it('Given development, Then the detail is still there to debug with', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const response = await proxyFetch(new Request('http://localhost/api/x'), {
      target: 'http://billing-db.internal/x',
      customFetch: failingFetch(),
    })

    expect(await response.text()).toContain(INTERNAL)
  })
})
