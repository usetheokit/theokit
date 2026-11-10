import { describe, expect, it } from 'vitest'

import { turnFailedError, turnFailureDetail } from './live/support/turn-failure.js'

const frame = { type: 'error', code: 'turn_failed' }

describe('turn failure detail for the live tests', () => {
  it('puts the instance reason in the thrown error', () => {
    const output = 'theoclaw: listening\ntheoclaw: turn failed: provider answered 429\nlater line\n'
    const error = turnFailedError(frame, output)
    expect(error.message).toContain('turn_failed')
    expect(error.message).toContain('theoclaw: turn failed: provider answered 429')
    expect(error.message).not.toContain('later line')
  })

  it('falls back to the whole output when no turn failed line exists', () => {
    expect(turnFailureDetail('boot trouble\n')).toContain('boot trouble')
  })

  it('does not leak a key, token or pattern-matched key', () => {
    const key = 'model-key-0123456789abcdef'
    const token = 'control-token-xyz-987'
    const output = `theoclaw: turn failed: bad ${key} for ${token}\nsk-abcdefghijklmnopqrstuvwxyz123456\n`
    const message = turnFailedError(frame, output, [key, token, undefined]).message
    expect(message).toContain('theoclaw: turn failed:')
    expect(message).not.toContain(key)
    expect(message).not.toContain(token)
    const whole = turnFailedError(frame, `no marker ${key} sk-abcdefghijklmnopqrstuvwxyz123456`, [key]).message
    expect(whole).not.toContain(key)
    expect(whole).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456')
  })
})
