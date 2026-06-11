/**
 * G3 canonical scenarios — Phase 6 / T6.1 acceptance.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 6 / T6.1.
 * Exercises 5 canonical defineAction scenarios end-to-end against the
 * server-actions-basic fixture using the real dev server (not a mocked
 * harness).
 *
 * Scenarios covered:
 *   1. devalue roundtrip preserves Date / Set / URL (ADR D1)
 *   2. validation error → 422 + flat envelope with auto-derived `fields`
 *      (already covered by onda4-mandatory — kept here for traceability)
 *   3. accept:'form' coerces FormData via formDataToObject (Astro pattern)
 *   4. csrf:false bypasses multi-header enforcement
 *   5. handler throws ActionError → status mapped + flat envelope
 *
 * Non-goal: re-cover what tests/unit/* already covers (serializeActionResult
 * shape, ActionInputError field-map, formDataToObject coercion). This file
 * is the end-to-end integration that proves the helpers wire together.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'

import { startDevServer } from '../../packages/theo/src/cli/commands/dev.js'

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures')

// devalue isn't a workspace-root dep — resolve via packages/theo/node_modules.
// Parse with URL reviver matching the server's stringify side
// (serializeActionResult registers a `URL: (value) => value.href` reducer).
async function devalueParse(s: string): Promise<unknown> {
  // @ts-expect-error — devalue lacks .d.ts at this resolved path; runtime is fine.
  const mod = (await import('../../packages/theo/node_modules/devalue/index.js')) as {
    parse: (s: string, revivers?: Record<string, (v: unknown) => unknown>) => unknown
  }
  return mod.parse(s, {
    URL: (href: unknown) => new URL(href as string),
  })
}

describe('G3 canonical scenarios — Phase 6 / T6.1', () => {
  let server: Awaited<ReturnType<typeof startDevServer>>
  let port: number

  beforeAll(async () => {
    server = await startDevServer(path.join(FIXTURES, 'server-actions-basic'), { port: 0 })
    const address = server.httpServer!.address()
    port = typeof address === 'object' && address ? address.port : 0
  }, 15000)

  afterAll(async () => {
    await server?.close()
  }, 15000)

  function urlFor(file: string, exportName: string): string {
    return `http://localhost:${port}/api/__actions/${file}/${exportName}`
  }

  // Scenario 1 — devalue roundtrip
  it('scenario 1: devalue roundtrip preserves Date / Set / URL', async () => {
    const res = await fetch(urlFor('g3-devalue', 'echoRichTypes'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Theo-Action': '1' },
      body: JSON.stringify({ seed: 'phoenix' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json+devalue')
    const data = (await devalueParse(await res.text())) as {
      seed: string
      when: Date
      tags: Set<string>
      homepage: URL
    }
    expect(data.seed).toBe('phoenix')
    expect(data.when).toBeInstanceOf(Date)
    expect(data.when.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(data.tags).toBeInstanceOf(Set)
    expect([...data.tags].sort((a, b) => a.localeCompare(b))).toEqual(['a', 'b', 'c'])
    // URL is roundtripped as a URL instance via the URL reviver in
    // serializeActionResult devalueStringify call.
    expect(data.homepage).toBeInstanceOf(URL)
    expect(data.homepage.href).toBe('https://example.com/theokit')
  })

  // Scenario 2 — validation envelope (cross-reference)
  it('scenario 2: validation failure -> 422 with auto-derived fields map', async () => {
    const res = await fetch(urlFor('create-user', 'createUser'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Theo-Action': '1' },
      body: JSON.stringify({ name: '', email: 'not-an-email' }),
    })
    expect(res.status).toBe(422)
    const data = (await res.json()) as {
      type: string
      code: string
      fields: Record<string, string[]>
    }
    expect(data.type).toBe('TheoActionInputError')
    expect(data.code).toBe('VALIDATION_ERROR')
    expect(Object.keys(data.fields).sort((a, b) => a.localeCompare(b))).toEqual(['email', 'name'])
  })

  // Scenario 3 — accept:'form' FormData coercion
  it("scenario 3: accept:'form' coerces FormData (number + boolean from strings)", async () => {
    const fd = new FormData()
    fd.append('name', 'Maria')
    fd.append('age', '30')
    fd.append('subscribe', 'true')
    const res = await fetch(urlFor('g3-form', 'submitForm'), {
      method: 'POST',
      headers: { 'X-Theo-Action': '1' },
      body: fd,
    })
    expect(res.status).toBe(200)
    const data = (await devalueParse(await res.text())) as {
      received: { name: string; age: number; subscribe: boolean }
    }
    expect(data.received.name).toBe('Maria')
    expect(data.received.age).toBe(30)
    expect(data.received.subscribe).toBe(true)
  })

  // Scenario 4 — csrf:false bypass
  it('scenario 4: csrf:false action accepts POST without X-Theo-Action header', async () => {
    const res = await fetch(urlFor('g3-no-csrf', 'publicEcho'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg: 'webhook payload' }),
    })
    expect(res.status).toBe(200)
    const data = (await devalueParse(await res.text())) as { echoed: string }
    expect(data.echoed).toBe('webhook payload')
  })

  // Scenario 5 — handler throws ActionError → mapped status + flat envelope
  it('scenario 5: handler-thrown ActionError -> mapped status + flat envelope', async () => {
    const res = await fetch(urlFor('g3-throws', 'denyAlways'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Theo-Action': '1' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
    const data = (await res.json()) as { type: string; code: string; message: string }
    expect(data.type).toBe('TheoActionError')
    expect(data.code).toBe('FORBIDDEN')
    expect(data.message).toBe('Access denied')
  })
})
