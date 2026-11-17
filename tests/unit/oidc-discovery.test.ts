import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  discoverOidcProvider,
  clearOidcCache,
  isSafeOidcUrl,
  OidcInsecureEndpointError,
} from '../../packages/theo/src/server/auth/oidc-discovery.js'

/**
 * T7.4 — OIDC Discovery 1.0 fetcher.
 *
 * EC-7: HTTPS enforced for non-localhost issuers (RFC 8414 §3).
 */

const mockMetadata = {
  issuer: 'https://provider.example',
  authorization_endpoint: 'https://provider.example/authorize',
  token_endpoint: 'https://provider.example/token',
  jwks_uri: 'https://provider.example/jwks.json',
}

describe('T7.4 — discoverOidcProvider', () => {
  let fetchSpy: any

  beforeEach(() => {
    clearOidcCache()
    fetchSpy = vi.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockImplementation(
      (async () =>
        new Response(JSON.stringify(mockMetadata), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    )
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('fetches the .well-known/openid-configuration', async () => {
    const m = await discoverOidcProvider('https://provider.example')
    expect(m.authorization_endpoint).toBe('https://provider.example/authorize')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect((fetchSpy.mock.calls[0][0] as string | URL).toString()).toContain(
      '.well-known/openid-configuration',
    )
  })

  it('caches the result — second call does not refetch', async () => {
    await discoverOidcProvider('https://provider.example')
    await discoverOidcProvider('https://provider.example')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('throws on 404', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 404 }))
    await expect(discoverOidcProvider('https://missing.example')).rejects.toThrow(/404/)
  })

  it('does NOT cache failures — second call retries', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 500 }))
    await expect(discoverOidcProvider('https://flaky.example')).rejects.toThrow()
    // Next call: fetchSpy still mocks the default 200 response
    const m = await discoverOidcProvider('https://flaky.example')
    expect(m.authorization_endpoint).toBeDefined()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('EC-7: rejects HTTP issuer (RFC 8414 §3 requires HTTPS in production)', async () => {
    await expect(discoverOidcProvider('http://insecure.example')).rejects.toThrow(/HTTPS/i)
  })

  it('allows http://localhost for dev', async () => {
    await expect(discoverOidcProvider('http://localhost:8080')).resolves.toBeDefined()
  })

  const respondWith = (doc: Record<string, unknown>) =>
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify(doc), { status: 200 }))

  it.each(['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint', 'jwks_uri'])(
    'rejects an http %s with OidcInsecureEndpointError',
    async (field) => {
      respondWith({ ...mockMetadata, [field]: 'http://evil.example/x' })
      const err = await discoverOidcProvider('https://provider.example').catch((e) => e)
      expect(err).toBeInstanceOf(OidcInsecureEndpointError)
      expect(err.field).toBe(field)
      expect(err.code).toBe('oidc_insecure_endpoint')
      expect(err.url).toBe('http://evil.example/x')
    },
  )

  it('accepts loopback http endpoints (127.0.0.2, [::1])', async () => {
    respondWith({
      ...mockMetadata,
      token_endpoint: 'http://127.0.0.2:8080/token',
      userinfo_endpoint: 'http://[::1]/token',
    })
    await expect(discoverOidcProvider('https://provider.example')).resolves.toBeDefined()
  })

  it('rejects http://0.0.0.0 endpoints', async () => {
    respondWith({ ...mockMetadata, token_endpoint: 'http://0.0.0.0:8080/token' })
    await expect(discoverOidcProvider('https://provider.example')).rejects.toMatchObject({
      field: 'token_endpoint',
    })
  })

  it('does not cache a rejected metadata document', async () => {
    respondWith({ ...mockMetadata, token_endpoint: 'http://evil.example/token' })
    await expect(discoverOidcProvider('https://provider.example')).rejects.toBeInstanceOf(
      OidcInsecureEndpointError,
    )
    respondWith(mockMetadata)
    await expect(discoverOidcProvider('https://provider.example')).resolves.toBeDefined()
  })

  it('throws a typed error for an http issuer, field issuer', async () => {
    await expect(discoverOidcProvider('http://insecure.example')).rejects.toMatchObject({
      name: 'OidcInsecureEndpointError',
      field: 'issuer',
    })
  })

  it('isSafeOidcUrl', () => {
    expect(isSafeOidcUrl('https://a.example/x')).toBe(true)
    expect(isSafeOidcUrl('http://localhost/x')).toBe(true)
    expect(isSafeOidcUrl('http://127.0.0.2/x')).toBe(true)
    expect(isSafeOidcUrl('http://[::1]/x')).toBe(true)
    expect(isSafeOidcUrl('http://0.0.0.0/x')).toBe(false)
    expect(isSafeOidcUrl('http://a.example/x')).toBe(false)
    expect(isSafeOidcUrl('not a url')).toBe(false)
  })
})
