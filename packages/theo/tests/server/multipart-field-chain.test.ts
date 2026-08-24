import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { formDataToObject } from '../../src/server/http/form-data-to-object.js'
import { appendField } from '../../src/server/multipart-fields.js'

/**
 * usetheokit/theokit#430, the other two links of the chain.
 *
 * The parser is only the first producer. A repeated field then passes through
 * `synthesizeFormData` (which rebuilds a FormData for the `accept: 'form'`
 * path) and finally `formDataToObject`, which hands the value to the
 * consumer's Zod schema. A fix at the parser alone would have moved the data
 * loss one layer down instead of removing it: appending an array to FormData
 * stringifies it to `'a,b'`.
 *
 * `formDataToObject` was already correct — it reads arrays with the native
 * `getAll`. That is worth asserting rather than assuming, because it is the
 * reason the fix is three small edits and not a redesign.
 */
describe('#430 — the shared representation', () => {
  it('promotes to an array only on the second occurrence', () => {
    const fields: Record<string, string | string[]> = {}

    appendField(fields, 'tags', 'a')
    expect(fields.tags).toBe('a')

    appendField(fields, 'tags', 'b')
    expect(fields.tags).toEqual(['a', 'b'])

    appendField(fields, 'tags', 'c')
    expect(fields.tags).toEqual(['a', 'b', 'c'])
  })

  it('keeps distinct keys independent', () => {
    const fields: Record<string, string | string[]> = {}
    appendField(fields, 'a', '1')
    appendField(fields, 'b', '2')
    appendField(fields, 'b', '3')

    expect(fields).toEqual({ a: '1', b: ['2', '3'] })
  })
})

describe('#430 — the consumer end recovers what the parser preserved', () => {
  /** What `synthesizeFormData` does, on the shape the fixed parser now emits. */
  function synthesize(fields: Record<string, string | string[]>): FormData {
    const fd = new FormData()
    for (const [name, value] of Object.entries(fields)) {
      if (Array.isArray(value)) for (const single of value) fd.append(name, single)
      else fd.append(name, value)
    }
    return fd
  }

  it('delivers every value to a z.array schema', () => {
    const fd = synthesize({ tags: ['first', 'second', 'third'] })
    const out = formDataToObject(fd, z.object({ tags: z.array(z.string()) }))

    expect(out.tags).toEqual(['first', 'second', 'third'])
  })

  it('still delivers a scalar to a z.string schema', () => {
    const fd = synthesize({ name: 'Ada' })
    const out = formDataToObject(fd, z.object({ name: z.string() }))

    expect(out.name).toBe('Ada')
  })

  it('coerces a repeated numeric field elementwise', () => {
    const fd = synthesize({ ids: ['1', '2', '3'] })
    const out = formDataToObject(fd, z.object({ ids: z.array(z.number()) }))

    expect(out.ids).toEqual([1, 2, 3])
  })
})

describe('#430 — a field name off the wire is not a property lookup', () => {
  /**
   * `fields[name]` walks the prototype chain. A form posting a field named
   * `constructor` would have found `Object.prototype.constructor` where the
   * code expected "nothing here yet", and stored `[Function, 'x']` in a map
   * typed as holding strings. The field name is chosen by whoever posts the
   * form, so this is a negative case, not a curiosity.
   */
  it.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'treats an inherited name (%s) as absent on first occurrence',
    (name) => {
      const fields: Record<string, string | string[]> = {}

      appendField(fields, name, 'first')
      expect(fields[name]).toBe('first')

      appendField(fields, name, 'second')
      expect(fields[name]).toEqual(['first', 'second'])
    },
  )

  it('does not let __proto__ reach the prototype', () => {
    const fields: Record<string, string | string[]> = {}
    appendField(fields, '__proto__', 'polluted')

    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
