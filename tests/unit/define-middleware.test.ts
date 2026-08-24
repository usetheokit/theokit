/**
 * The published middleware contract (usetheokit/theokit#345).
 *
 * These assertions used to construct `(request, next) => next(request)` handlers — the continuation
 * shape. That shape described a pipeline nothing in this repository implements: the file-scan runner
 * executes BEFORE routing and has no downstream `Response` to return from `next`. Measured
 * consequence: `MiddlewareHandler` had zero runtime consumers while the README documented the
 * builder that produces it.
 *
 * The contract is now `(request, context) => Response | void`, which needs no continuation and is
 * the shape `executeWebRequest` already ran. `middleware-builder-runs-in-the-file-scan.test.ts` is
 * the one that proves it actually runs; this one covers the definition itself.
 */
import { describe, it, expect } from 'vitest'

import {
  defineMiddleware,
  WEB_SHAPED_MIDDLEWARE,
} from '../../packages/theo/src/server/define/define-middleware.js'

describe('defineMiddleware', () => {
  it('returns the handler unchanged (same reference)', () => {
    const handler = (request: Request, context: Record<string, unknown>): void => {
      context.path = new URL(request.url).pathname
    }

    // Identity matters: a middleware closes over state, so wrapping it would give the runner a
    // different function from the one the author wrote.
    expect(defineMiddleware(handler)).toBe(handler)
  })

  it('accepts a handler that answers the request itself', () => {
    const handler = (): Response => new Response('Unauthorized', { status: 401 })

    expect(defineMiddleware(handler)).toBe(handler)
  })

  it('records the declared shape, so a runner can dispatch rather than guess', () => {
    const handler = (): undefined => undefined

    // Both middleware shapes are plain functions and both can have length 2, so nothing observable
    // distinguishes them at the call site. The brand is what the file-scan runner reads.
    expect(WEB_SHAPED_MIDDLEWARE in defineMiddleware(handler)).toBe(true)
  })

  it('brands non-enumerably, so a handler still spreads and serializes as itself', () => {
    const handler = (): undefined => undefined
    defineMiddleware(handler)

    expect(Object.keys(handler)).toEqual([])
    expect(Object.getOwnPropertySymbols(handler)).toContain(WEB_SHAPED_MIDDLEWARE)
  })
})
