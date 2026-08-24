import { describe, it, expect } from 'vitest'

import { parseWebRequestBody } from '../../src/server/body-parser-web.js'

/**
 * usetheokit/theokit#430 — a repeated multipart field lost every value but the last.
 *
 * `fields[key] = value` inside the `form.entries()` loop overwrote on each
 * occurrence, so a `<select multiple>` or a repeated checkbox arrived at the
 * action's Zod schema as a single string. Nothing errored: the shape was
 * plausible, just wrong, which is why it survived to a consumer.
 *
 * Both halves matter and both are asserted here. Accumulating is the fix; NOT
 * accumulating a field that occurred once is the constraint on the fix, because
 * every existing consumer does `body.name.trim()` on a scalar and would break
 * if a one-element array replaced the string.
 */
function multipart(entries: [string, string][]): Request {
  const form = new FormData()
  for (const [k, v] of entries) form.append(k, v)
  return new Request('https://test.local/a', { method: 'POST', body: form })
}

describe('#430 — multipart repeated fields', () => {
  it('keeps every value of a field that repeats', async () => {
    const parsed = await parseWebRequestBody(
      multipart([
        ['tags', 'first'],
        ['tags', 'second'],
        ['tags', 'third'],
      ]),
    )

    expect(parsed.fields.tags).toEqual(['first', 'second', 'third'])
  })

  it('leaves a field that occurs once as a plain string', async () => {
    const parsed = await parseWebRequestBody(multipart([['name', 'Ada']]))

    expect(parsed.fields.name).toBe('Ada')
  })

  it('accumulates only the repeated key, mixing both shapes in one body', async () => {
    const parsed = await parseWebRequestBody(
      multipart([
        ['name', 'Ada'],
        ['tags', 'a'],
        ['tags', 'b'],
      ]),
    )

    expect(parsed.fields).toEqual({ name: 'Ada', tags: ['a', 'b'] })
  })

  it('keeps a repeated empty string rather than collapsing it', async () => {
    const parsed = await parseWebRequestBody(
      multipart([
        ['opt', ''],
        ['opt', ''],
      ]),
    )

    expect(parsed.fields.opt).toEqual(['', ''])
  })
})
