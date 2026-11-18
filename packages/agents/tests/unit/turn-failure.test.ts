import { describe, expect, it } from 'vitest'
import { TheokitAgentError } from '@theokit/sdk/errors'
import {
  DEFAULT_TURN_FAILURE_HINTS,
  classifyTurnFailure,
  describeTurnFailure,
} from '../../src/index.js'

const provider = (code: string, statusCode?: number, retry = false): TheokitAgentError =>
  new TheokitAgentError('provider said no', {
    isRetryable: retry,
    metadata: { provider: 'p', endpoint: '/e', code: code as never, statusCode },
  })

describe('turn failure', () => {
  it('a plain Error whose message contains 500 is not transient', () => {
    const f = classifyTurnFailure(new Error('prompt has 500 tokens over the limit'))
    expect(f.transient).toBe(false)
    expect(f.code).toBe('unknown')
  })

  it('a typed code in the cause chain wins over the message text', () => {
    const f = classifyTurnFailure(
      new Error('rate limit hit', { cause: provider('auth_failed', 401) }),
    )
    expect(f.code).toBe('auth_failed')
    expect(f.message).toBe('rate limit hit')
  })

  it('typed status makes it transient, and cycles terminate', () => {
    const a = new Error('a') as Error & { cause?: unknown }
    a.cause = new Error('b', { cause: a })
    expect(classifyTurnFailure(a).code).toBe('unknown')
    expect(
      classifyTurnFailure(new Error('x', { cause: provider('server_error', 503) })).transient,
    ).toBe(true)
  })

  it('provider_unreachable and invalid_model get their own hint', () => {
    expect(DEFAULT_TURN_FAILURE_HINTS.provider_unreachable).toBeTruthy()
    expect(DEFAULT_TURN_FAILURE_HINTS.invalid_model).toBeTruthy()
    expect(DEFAULT_TURN_FAILURE_HINTS.provider_unreachable).not.toBe(
      DEFAULT_TURN_FAILURE_HINTS.invalid_model,
    )
  })

  it('a blank message is described as the turn failed with no message', () => {
    const f = classifyTurnFailure(new Error('  '))
    expect(f.message).toBe('the turn failed with no message')
    expect(describeTurnFailure(f)).toBe('the turn failed with no message')
    expect(classifyTurnFailure(undefined).message).toBe('the turn failed with no message')
  })

  it('attempts of 1 is not reported, attempts of 3 is', () => {
    const f = classifyTurnFailure(provider('rate_limit', 429, true))
    expect(describeTurnFailure(f, { attempts: 1 })).not.toContain('attempts')
    expect(describeTurnFailure(f, { attempts: 3 })).toContain('after 3 attempts')
    expect(describeTurnFailure(f)).toMatch(/^provider said no \[rate_limit\]: /)
  })

  it('a caller hint replaces the default for that code only', () => {
    const hints = { rate_limit: 'slow down' }
    const rl = describeTurnFailure(classifyTurnFailure(provider('rate_limit')), { hints })
    expect(rl).toContain(': slow down')
    const auth = describeTurnFailure(classifyTurnFailure(provider('auth_failed')), { hints })
    expect(auth).toContain(DEFAULT_TURN_FAILURE_HINTS.auth_failed)
  })

  it('an untyped message still gets a next step, and the tool-image case is named', () => {
    const d = (m: string, hints = {}) =>
      describeTurnFailure(classifyTurnFailure(new Error(m)), { hints })
    expect(d('provider "x" does not support image content in tool results')).toContain(
      'tool returned an image',
    )
    expect(d('Unauthorized')).toContain(DEFAULT_TURN_FAILURE_HINTS.auth_failed)
    expect(d('quota exhausted')).toContain(DEFAULT_TURN_FAILURE_HINTS.quota_exceeded)
    expect(d('connect ECONNREFUSED')).toContain(DEFAULT_TURN_FAILURE_HINTS.provider_unreachable)
    expect(d('context length exceeded')).toContain(DEFAULT_TURN_FAILURE_HINTS.context_too_long)
    expect(d('quota exhausted', { quota_exceeded: 'top up' })).toContain(': top up')
    expect(d('prompt has 500 tokens')).toBe('prompt has 500 tokens')
    expect(classifyTurnFailure(new Error('rate limit')).transient).toBe(false)
  })
})
