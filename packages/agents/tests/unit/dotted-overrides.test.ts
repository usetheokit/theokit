import { describe, expect, it } from 'vitest'
import { DottedOverrideError, parseDottedOverrides } from '../../src/config-entry.js'

describe('parseDottedOverrides', () => {
  it('a.b=1 and a.c=2 build one nested object', () => {
    expect(parseDottedOverrides(['a.b=1', 'a.c=2', 'x=y=z'])).toEqual({
      a: { b: '1', c: '2' },
      x: 'y=z',
    })
  })

  it.each([
    '__proto__.polluted=1',
    'a.__proto__.p=1',
    'constructor.x=1',
    'a.prototype.x=1',
    'constructor.prototype.p=1',
  ])('%s throws DottedOverrideError and Object.prototype is unchanged', (pair) => {
    expect(() => parseDottedOverrides([pair])).toThrow(DottedOverrideError)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).p).toBeUndefined()
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it('a pair without = throws DottedOverrideError naming the pair', () => {
    expect(() => parseDottedOverrides(['novalue'])).toThrow(/novalue/)
    expect(() => parseDottedOverrides(['novalue'])).toThrow(DottedOverrideError)
  })

  it('a=1 then a.b=2 throws', () => {
    expect(() => parseDottedOverrides(['a=1', 'a.b=2'])).toThrow(DottedOverrideError)
  })

  it('a.b=2 then a=1 throws', () => {
    expect(() => parseDottedOverrides(['a.b=2', 'a=1'])).toThrow(DottedOverrideError)
  })

  it('an empty segment (a..b=1) throws', () => {
    expect(() => parseDottedOverrides(['a..b=1'])).toThrow(DottedOverrideError)
    expect(() => parseDottedOverrides(['=1'])).toThrow(DottedOverrideError)
  })

  it('coerce receives the full dotted path', () => {
    const seen: string[] = []
    const out = parseDottedOverrides(['profiles.x.memory=true'], {
      coerce: (path, raw) => (seen.push(path), raw === 'true'),
    })
    expect(seen).toEqual(['profiles.x.memory'])
    expect(out).toEqual({ profiles: { x: { memory: true } } })
  })

  it('a coerced object is a value, and a repeated leaf takes the last value', () => {
    expect(() => parseDottedOverrides(['a=1', 'a.b=2'], { coerce: () => ({}) })).toThrow(
      DottedOverrideError,
    )
    expect(parseDottedOverrides(['a=1', 'a=2'])).toEqual({ a: '2' })
    expect(parseDottedOverrides(['toString.x=1'])).toEqual({ toString: { x: '1' } })
  })
})
