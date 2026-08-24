/**
 * One contract, three transports (`rules/three-target-parity.md` rule 2): the same route reaching
 * the same failure must not disclose more over one transport than over another.
 *
 * The Node runner replaces an INTERNAL_ERROR's message with a generic one in production
 * (`sendError`), and so does the Web runner's own error builder (`buildErrorResponse`). But an
 * exception escaping a Web handler does not travel through either — it goes to
 * `handlerErrorResponse`, which builds its Response by hand from `serverErrorToEnvelope(err)` and
 * therefore ships `err.message` and `err.cause` verbatim.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'

import { defineRoute } from '../../packages/theo/src/server/define/define-route.js'
import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'
import { buildErrorResponse } from '../../packages/theo/src/server/http/send-response.js'

// Shaped like an internal failure without being shaped like a credential: a `user:pass@host`
// URL here is indistinguishable from a real leak to a secret scanner, and a test fixture that
// trips the repository's own gate teaches everyone to skim past it.
const LEAK = 'upstream billing-db.internal:5432 refused the connection'

function req(): Request {
  return new Request('http://localhost/api/test', { method: 'GET' })
}

describe('Web runner — an internal error discloses no more than the Node runner does', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('Given production, When a handler throws, Then the internal message is not in the body', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const route = {
      GET: defineRoute({
        handler: () => {
          throw new Error(LEAK)
        },
      }),
    }

    const response = await executeWebRequest(req(), route)
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(body).not.toContain(LEAK)
    expect(body).not.toContain('billing-db.internal')
  })

  it('Given production, When a handler throws, Then `cause` is not in the body either', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const route = {
      GET: defineRoute({
        handler: () => {
          throw new Error('boom', { cause: LEAK })
        },
      }),
    }

    const body = await (await executeWebRequest(req(), route)).text()
    expect(body).not.toContain(LEAK)
  })

  // The redaction is production-only, exactly as the Node runner's is: taking the message away in
  // development would make the framework harder to debug for no gain.
  it('Given development, When a handler throws, Then the message is still returned', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const route = {
      GET: defineRoute({
        handler: () => {
          throw new Error(LEAK)
        },
      }),
    }

    const body = await (await executeWebRequest(req(), route)).text()
    expect(body).toContain(LEAK)
  })

  // The two Web paths must agree with each other, not merely each be defensible alone.
  it('Given production, Then the hand-built path says what buildErrorResponse says', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const viaBuilder = await buildErrorResponse({
      code: 'INTERNAL_ERROR',
      message: LEAK,
      status: 500,
    }).json()

    const route = {
      GET: defineRoute({
        handler: () => {
          throw new Error(LEAK)
        },
      }),
    }
    const viaHandler = (await (await executeWebRequest(req(), route)).json()) as {
      error?: { message?: string }
      message?: string
    }

    const builderMessage = (viaBuilder as { error: { message: string } }).error.message
    const handlerMessage = viaHandler.error?.message ?? viaHandler.message
    expect(handlerMessage).toBe(builderMessage)
  })
})
