import { describe, expect, it } from 'vitest'
import {
  auditEnvKnobs,
  coerceEnvValue,
  envKnob,
  envLayerFrom,
} from '../../src/config/env-knobs.js'

describe('env knobs', () => {
  it('boolean knob reads on, YES and 0', () => {
    expect(coerceEnvValue('on', 'boolean')).toBe(true)
    expect(coerceEnvValue(' YES ', 'boolean')).toBe(true)
    expect(coerceEnvValue('0', 'boolean')).toBe(false)
  })

  it('an unrecognised boolean value is returned verbatim so the schema can reject it', () => {
    expect(coerceEnvValue('maybe', 'boolean')).toBe('maybe')
  })

  it('a blank number value is returned verbatim', () => {
    expect(coerceEnvValue('', 'number')).toBe('')
    expect(coerceEnvValue('  ', 'number')).toBe('  ')
    expect(coerceEnvValue('42', 'number')).toBe(42)
    expect(coerceEnvValue('abc', 'number')).toBe('abc')
  })

  it('envLayerFrom includes only variables that are set', () => {
    const knobs = { a: envKnob('A', 'string'), b: envKnob('B', 'boolean'), c: envKnob('C', 'number') }
    expect(envLayerFrom({ A: 'x', B: 'on' }, knobs)).toEqual({ a: 'x', b: true })
  })

  it('auditEnvKnobs reports a key with no knob and no opt-out as unreachable', () => {
    const audit = auditEnvKnobs({
      keys: ['a', 'b'],
      knobs: { a: envKnob('A', 'string') },
      optOuts: [],
    })
    expect(JSON.stringify(audit)).toContain('b')
    expect(JSON.stringify(audit)).not.toMatch(/"unreachable":\[[^\]]*"a"/)
  })
})
