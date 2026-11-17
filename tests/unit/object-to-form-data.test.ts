import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  FormDataEncodingError,
  objectToFormData,
} from '../../packages/theo/src/client/object-to-form-data.js'
import { formDataToObject } from '../../packages/theo/src/server/http/form-data-to-object.js'

function roundTrip(schema: z.ZodObject<z.ZodRawShape>, v: Record<string, unknown>) {
  return formDataToObject(objectToFormData(v, schema), schema)
}

describe('objectToFormData', () => {
  it('round-trips scalars', () => {
    const s = z.object({ a: z.string(), n: z.number(), t: z.boolean(), f: z.boolean() })
    const v = { a: 'hi', n: 42, t: true, f: false }
    expect(roundTrip(s, v)).toEqual(v)
  })

  it('leaves optional fields undefined', () => {
    const s = z.object({ a: z.string(), b: z.string().optional() })
    const out = roundTrip(s, { a: 'x' })
    expect(out.b).toBeUndefined()
    expect(out.a).toBe('x')
  })

  it('round-trips nested objects three levels deep', () => {
    const s = z.object({ a: z.object({ b: z.object({ c: z.object({ d: z.number() }) }) }) })
    const v = { a: { b: { c: { d: 7 } } } }
    expect(roundTrip(s, v)).toEqual(v)
  })

  it('round-trips arrays of strings, numbers and an empty array', () => {
    const s = z.object({ s: z.array(z.string()), n: z.array(z.number()), e: z.array(z.string()) })
    const v = { s: ['a', 'b'], n: [1, 2, 3], e: [] }
    expect(roundTrip(s, v)).toEqual(v)
  })

  it('round-trips a File field', () => {
    const s = z.object({ file: z.instanceof(File) })
    const file = new File(['x'], 'x.txt')
    const out = roundTrip(s, { file })
    expect(out.file).toBeInstanceOf(File)
    expect((out.file as File).name).toBe('x.txt')
  })

  it('encodes a FileList-like as one entry per file', () => {
    const s = z.object({ files: z.array(z.instanceof(File)) })
    const list = { 0: new File(['a'], 'a.txt'), 1: new File(['b'], 'b.txt'), length: 2 }
    const fd = objectToFormData({ files: list }, s)
    expect(fd.getAll('files')).toHaveLength(2)
  })

  it('refuses an array of objects, naming the field', () => {
    const s = z.object({ items: z.array(z.object({ a: z.string() })) })
    try {
      objectToFormData({ items: [{ a: 'x' }] }, s)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(FormDataEncodingError)
      expect((e as FormDataEncodingError).path).toBe('items')
      expect((e as FormDataEncodingError).code).toBe('form_data_unencodable')
    }
  })

  it('refuses a nested object that emits no entries, naming the path', () => {
    const s = z.object({ group: z.object({ items: z.array(z.string()) }) })
    try {
      objectToFormData({ group: { items: [] } }, s)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(FormDataEncodingError)
      expect((e as FormDataEncodingError).path).toBe('group')
    }
  })

  it('refuses a nested object whose fields are all absent', () => {
    const s = z.object({ group: z.object({ note: z.string().optional() }) })
    expect(() => objectToFormData({ group: {} }, s)).toThrow(FormDataEncodingError)
  })
})
