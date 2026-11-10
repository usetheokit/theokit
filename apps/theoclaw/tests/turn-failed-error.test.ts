import { describe, expect, it } from 'vitest'

import { turnFailedError } from './live/support/turn-failed.js'

describe('turnFailedError', () => {
  const frame = { type: 'error', code: 'turn_failed' }

  it('carries the reason the instance wrote to stderr', () => {
    const output = 'started\ntheoclaw: turn failed: provider answered 429\nother noise\n'
    const error = turnFailedError(frame, output)
    expect(error.message).toContain('theoclaw: turn failed: provider answered 429')
    expect(error.message).toContain('turn_failed')
    expect(error.message).not.toContain('other noise')
  })

  it('falls back to the whole output when there is no turn failed line', () => {
    expect(turnFailedError(frame, 'listening on 1\nboom\n').message).toContain('boom')
  })

  it('keeps a key and a control token out of the error', () => {
    const key = 'sk-or-v1-abcdef0123456789abcdef0123456789'
    const token = 'control-token-value-123'
    const output = `theoclaw: turn failed: bad key ${key} token ${token}\n`
    const message = turnFailedError(frame, output, [token]).message
    expect(message).toContain('theoclaw: turn failed:')
    expect(message).not.toContain(key)
    expect(message).not.toContain(token)
  })

  it('masks a secret from the environment in the whole-output fallback', () => {
    process.env.THEOCLAW_TEST_API_KEY = 'plain-secret-value-9'
    try {
      expect(turnFailedError(frame, 'x plain-secret-value-9 y').message).not.toContain(
        'plain-secret-value-9',
      )
    } finally {
      delete process.env.THEOCLAW_TEST_API_KEY
    }
  })
})
