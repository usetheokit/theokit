import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startDevServer } from '../../packages/theo/src/cli/commands/dev.js'
import path from 'node:path'

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures')

// devalue isn't a workspace-root dep — resolve via packages/theo/node_modules.
async function devalueParse(s: string): Promise<unknown> {
  // @ts-expect-error — devalue lacks .d.ts at this resolved path; runtime is fine.
  const mod = (await import('../../packages/theo/node_modules/devalue/index.js')) as {
    parse: (s: string) => unknown
  }
  return mod.parse(s)
}

describe('Onda 4 — Server Actions', () => {
  let server: Awaited<ReturnType<typeof startDevServer>>
  let port: number
  let baseUrl: string

  beforeAll(async () => {
    server = await startDevServer(path.join(FIXTURES, 'server-actions-basic'), { port: 0 })
    const address = server.httpServer!.address()
    port = typeof address === 'object' && address ? address.port : 0
    baseUrl = `http://localhost:${port}/api/__actions/create-user/createUser`
  }, 15000)

  afterAll(async () => {
    await server?.close()
  }, 15000)

  // Teste 1 — Action com input válido (T1.3 sub-C: body is devalue-encoded)
  it('POST with valid input returns 200 with handler result', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Theo-Action': '1' },
      body: JSON.stringify({ name: 'Paulo', email: 'paulo@example.com' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json+devalue')
    const data = await devalueParse(await res.text())
    expect(data).toEqual({ id: '1', name: 'Paulo', email: 'paulo@example.com' })
  })

  // Teste 2 — Input inválido (T0.1 ActionInputError: 422 + flat envelope w/ fields)
  it('POST with invalid input returns 422 VALIDATION_ERROR with field map', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Theo-Action': '1' },
      body: JSON.stringify({ name: '', email: 'bad' }),
    })
    expect(res.status).toBe(422)
    const data = (await res.json()) as {
      type: string
      code: string
      message: string
      issues: unknown[]
      fields: Record<string, string[]>
    }
    expect(data.type).toBe('TheoActionInputError')
    expect(data.code).toBe('VALIDATION_ERROR')
    expect(data.issues.length).toBeGreaterThan(0)
    // Field map exposes both bad keys (T0.1 + ADR D6 dot-notation)
    expect(Object.keys(data.fields).sort((a, b) => a.localeCompare(b))).toEqual(['email', 'name'])
  })

  // Teste 3 — CSRF: sem X-Theo-Action header → 403
  it('POST without X-Theo-Action header returns 403', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Paulo', email: 'paulo@example.com' }),
    })
    expect(res.status).toBe(403)
  })

  // Teste 4 — Action inexistente → 404
  it('POST to nonexistent action returns 404', async () => {
    const res = await fetch(`http://localhost:${port}/api/__actions/nonexistent/foo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Theo-Action': '1' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
  })

  // Teste 5 — GET → 405
  it('GET on action endpoint returns 405', async () => {
    const res = await fetch(baseUrl, {
      headers: { 'X-Theo-Action': '1' },
    })
    expect(res.status).toBe(405)
  })

  // Extra: URL malformada (sem exportName)
  it('POST with malformed URL returns 400', async () => {
    const res = await fetch(`http://localhost:${port}/api/__actions/create-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Theo-Action': '1' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
