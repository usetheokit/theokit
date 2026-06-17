import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createOpenApiHandler } from '../../packages/theo/src/server/openapi/serve-docs.js'

const TMP = join(import.meta.dirname, '../../.tmp-openapi-test')

function makeRequest(path: string, method = 'GET'): Request {
  return new Request(`http://localhost:3000${path}`, { method })
}

describe('OpenAPI serve-docs', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
  })
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  it('GET /api/docs returns Scalar HTML', () => {
    const handler = createOpenApiHandler()
    const res = handler(makeRequest('/api/docs'))
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    expect(res!.headers.get('content-type')).toContain('text/html')
  })

  it('Scalar HTML contains CDN script tag', async () => {
    const handler = createOpenApiHandler()
    const res = handler(makeRequest('/api/docs'))!
    const html = await res.text()
    expect(html).toContain('cdn.jsdelivr.net/npm/@scalar/api-reference')
    expect(html).toContain('<script id="api-reference"')
    expect(html).toContain('data-url="/api/docs/openapi.json"')
  })

  it('custom docsPath works', () => {
    const handler = createOpenApiHandler({ docsPath: '/docs' })
    const res = handler(makeRequest('/docs'))
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
  })

  it('custom pageTitle is escaped in HTML', async () => {
    const handler = createOpenApiHandler({ pageTitle: '<script>alert("xss")</script>' })
    const res = handler(makeRequest('/api/docs'))!
    const html = await res.text()
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>alert')
  })

  it('GET /api/docs/openapi.json returns spec when file exists', async () => {
    const specPath = join(TMP, 'openapi.json')
    writeFileSync(
      specPath,
      JSON.stringify({ openapi: '3.0.0', info: { title: 'Test', version: '1.0' } }),
    )

    const handler = createOpenApiHandler({ specFilePath: specPath })
    const res = handler(makeRequest('/api/docs/openapi.json'))!
    expect(res.status).toBe(200)
    const body = (await res.json()) as { openapi: string }
    expect(body.openapi).toBe('3.0.0')
  })

  it('GET /api/docs/openapi.json returns 503 when file missing', async () => {
    const handler = createOpenApiHandler({ specFilePath: join(TMP, 'nonexistent.json') })
    const res = handler(makeRequest('/api/docs/openapi.json'))!
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('OPENAPI_NOT_EMITTED')
  })

  it('GET /api/docs/openapi.json returns 413 when file too large', async () => {
    const specPath = join(TMP, 'huge.json')
    // Create a file > 10MB
    writeFileSync(specPath, '{"x":"' + 'a'.repeat(11 * 1024 * 1024) + '"}')

    const handler = createOpenApiHandler({ specFilePath: specPath })
    const res = handler(makeRequest('/api/docs/openapi.json'))!
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('OPENAPI_TOO_LARGE')
  })

  it('POST /api/docs returns null (passthrough)', () => {
    const handler = createOpenApiHandler()
    const res = handler(makeRequest('/api/docs', 'POST'))
    expect(res).toBeNull()
  })

  it('DELETE /api/docs returns null (passthrough)', () => {
    const handler = createOpenApiHandler()
    const res = handler(makeRequest('/api/docs', 'DELETE'))
    expect(res).toBeNull()
  })

  it('GET /other returns null (passthrough)', () => {
    const handler = createOpenApiHandler()
    const res = handler(makeRequest('/other'))
    expect(res).toBeNull()
  })

  it('CSP header allows CDN host', () => {
    const handler = createOpenApiHandler()
    const res = handler(makeRequest('/api/docs'))!
    const csp = res.headers.get('content-security-policy')
    expect(csp).toContain('cdn.jsdelivr.net')
  })

  it('default options work (no args)', () => {
    const handler = createOpenApiHandler()
    expect(typeof handler).toBe('function')
    const res = handler(makeRequest('/api/docs'))
    expect(res).not.toBeNull()
  })

  it('spec response has no-cache header', async () => {
    const specPath = join(TMP, 'spec.json')
    writeFileSync(specPath, '{"openapi":"3.0.0"}')
    const handler = createOpenApiHandler({ specFilePath: specPath })
    const res = handler(makeRequest('/api/docs/openapi.json'))!
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  it('path traversal in specFilePath throws', () => {
    expect(() => createOpenApiHandler({ specFilePath: '../../../etc/passwd' })).toThrow(
      'must not contain ".."',
    )
  })

  it('embedded ".." segment in specFilePath throws (resolve() would collapse it)', () => {
    // The old post-resolve guard missed this: resolve('a/../../etc/passwd')
    // normalizes the '..' away, leaving no '..' to detect.
    expect(() => createOpenApiHandler({ specFilePath: 'a/../../etc/passwd' })).toThrow(
      'must not contain ".."',
    )
  })

  it('".." with a Windows separator in specFilePath throws', () => {
    expect(() => createOpenApiHandler({ specFilePath: '..\\..\\windows\\system32' })).toThrow(
      'must not contain ".."',
    )
  })

  it('legitimate absolute specFilePath (no "..") is accepted', () => {
    const specPath = join(TMP, 'abs-spec.json')
    writeFileSync(specPath, '{"openapi":"3.0.0"}')
    // join() produces an absolute path with no '..' — must NOT throw.
    expect(() => createOpenApiHandler({ specFilePath: specPath })).not.toThrow()
  })
})
