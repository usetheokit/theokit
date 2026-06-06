/**
 * T5a.2 Phase E — executeWebRequest + bodyParser: 'full' integration tests.
 *
 * Verifies that `executeWebRequest(request, routeModule, { bodyParser: 'full' })`
 * delegates body parsing to `parseWebRequestBody` so handlers can consume
 * multipart/form-data via `body?.fields` + `body?.files`.
 *
 * Inline-only mode (default) is unchanged — verified by the existing Phase A
 * `handler-web-standards.test.ts`.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase E.
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { defineRoute } from '../../packages/theo/src/server/define/define-route.js'
import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'

// ParsedWebBody shape from body-parser-web.ts (subset relevant to tests)
interface ParsedWebBodyShape {
  json?: unknown
  fields: Record<string, string>
  files: { fieldName: string; filename: string; contentType: string; size: number }[]
}

const multipartRoute = {
  POST: defineRoute({
    // Body schema is `any` because parseWebRequestBody returns a ParsedWebBody
    // struct (json|fields|files), not a plain JSON object. Real consumers
    // typically use a custom Zod refine to validate the shape.
    body: z.any(),
    handler({ body }) {
      // Extract field count + file count for test assertion
      const parsed = body as ParsedWebBodyShape | undefined
      return {
        hasBody: parsed !== undefined,
        fieldCount: parsed ? Object.keys(parsed.fields).length : 0,
        fileCount: parsed ? parsed.files.length : 0,
        firstFileName: parsed?.files[0]?.filename,
        firstFileSize: parsed?.files[0]?.size,
      }
    },
  }),
}

const jsonRoute = {
  POST: defineRoute({
    body: z.any(),
    handler({ body }) {
      // Under bodyParser: 'full', body for JSON requests is
      // { json: {...}, fields: {}, files: [] }
      const parsed = body as ParsedWebBodyShape | undefined
      return {
        jsonValue: parsed?.json,
        fieldCount: parsed ? Object.keys(parsed.fields).length : 0,
        fileCount: parsed ? parsed.files.length : 0,
      }
    },
  }),
}

describe('executeWebRequest + bodyParser: "full" (T5a.2 Phase E)', () => {
  it('JSON request → body.json populated; body.fields/files empty', async () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alice', age: 30 }),
    })
    const response = await executeWebRequest(request, jsonRoute, { bodyParser: 'full' })
    expect(response.status).toBe(200)
    const result = (await response.json()) as {
      jsonValue: { name: string; age: number }
      fieldCount: number
      fileCount: number
    }
    expect(result.jsonValue).toEqual({ name: 'alice', age: 30 })
    expect(result.fieldCount).toBe(0)
    expect(result.fileCount).toBe(0)
  })

  it('multipart/form-data with text fields only → body.fields populated', async () => {
    const formData = new FormData()
    formData.append('name', 'alice')
    formData.append('role', 'admin')
    const request = new Request('http://example.com/api', {
      method: 'POST',
      body: formData,
    })
    const response = await executeWebRequest(request, multipartRoute, { bodyParser: 'full' })
    expect(response.status).toBe(200)
    const result = (await response.json()) as {
      hasBody: boolean
      fieldCount: number
      fileCount: number
    }
    expect(result.hasBody).toBe(true)
    expect(result.fieldCount).toBe(2)
    expect(result.fileCount).toBe(0)
  })

  it('multipart/form-data with file upload → body.files populated with filename + size', async () => {
    const formData = new FormData()
    formData.append('title', 'Avatar')
    const fileContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) // PNG magic
    const file = new File([fileContent], 'avatar.png', { type: 'image/png' })
    formData.append('avatar', file)

    const request = new Request('http://example.com/api', {
      method: 'POST',
      body: formData,
    })
    const response = await executeWebRequest(request, multipartRoute, { bodyParser: 'full' })
    expect(response.status).toBe(200)
    const result = (await response.json()) as {
      hasBody: boolean
      fieldCount: number
      fileCount: number
      firstFileName?: string
      firstFileSize?: number
    }
    expect(result.fieldCount).toBe(1)
    expect(result.fileCount).toBe(1)
    expect(result.firstFileName).toBe('avatar.png')
    expect(result.firstFileSize).toBe(8)
  })

  it("empty body in 'full' mode → handler treats body as undefined", async () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    })
    const response = await executeWebRequest(request, jsonRoute, { bodyParser: 'full' })
    expect(response.status).toBe(200)
    const result = (await response.json()) as {
      jsonValue: unknown
      fieldCount: number
      fileCount: number
    }
    // Empty body → parseWebRequestBody returns empty {fields, files}; parseBodyFull
    // converts that to undefined → handler sees body=undefined → Zod any-passes.
    expect(result.jsonValue).toBeUndefined()
    expect(result.fieldCount).toBe(0)
    expect(result.fileCount).toBe(0)
  })

  it("default 'inline' mode still handles JSON without delegating to parseWebRequestBody", async () => {
    // Verify Phase A behavior unchanged: when bodyParser is not 'full',
    // the inline parser handles JSON and returns the raw parsed value
    // (not wrapped in {json, fields, files}).
    const route = {
      POST: defineRoute({
        body: z.object({ name: z.string() }),
        handler({ body }) {
          const typed = body as { name: string }
          return { greeting: `hello, ${typed.name}` }
        },
      }),
    }
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bob' }),
    })
    // No bodyParser opt → defaults to 'inline'
    const response = await executeWebRequest(request, route)
    expect(response.status).toBe(200)
    const result = (await response.json()) as { greeting: string }
    expect(result.greeting).toBe('hello, bob')
  })
})
