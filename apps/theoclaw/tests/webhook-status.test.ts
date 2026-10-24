import { describe, expect, it } from 'vitest'

import { statusFor } from '../src/webhooks/status.js'

/**
 * FR-009: a webhook answers for the worst outcome of the batch it delivered. `no_handler` means
 * nothing received the message, so the provider must retry (503); `handler_threw` is the runner's
 * own failure (500); only a batch where every delivery was scheduled answers 200.
 */
describe('statusFor', () => {
  it('answers 200 when every delivery was scheduled', () => {
    expect(statusFor(['ok', 'ok'])).toBe(200)
  })

  it('answers 503 when any delivery found no handler', () => {
    expect(statusFor(['ok', 'handler_threw', 'no_handler'])).toBe(503)
  })

  it('answers 500 when a delivery threw and none lacked a handler', () => {
    expect(statusFor(['ok', 'handler_threw'])).toBe(500)
  })

  it('answers for the worst outcome whatever the order', () => {
    expect(statusFor(['no_handler', 'handler_threw', 'ok'])).toBe(503)
  })

  it('answers 200 for an empty batch', () => {
    expect(statusFor([])).toBe(200)
  })
})
