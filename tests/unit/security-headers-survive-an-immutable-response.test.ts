/**
 * `withSecurityHeaders` must not try to mutate a Response it did not create.
 *
 * Found by deploying, 2026-09-26 (B-263). The function is `headers.set()` in a loop, and a Response
 * that came from a binding or from `fetch()` carries an IMMUTABLE headers guard. So the moment the
 * Cloudflare worker actually reached the static-asset branch, it threw:
 *
 *     TypeError: Can't modify immutable headers.
 *       at withSecurityHeaders (worker.js:69439:55)
 *       at handleRequest (worker.js:102382:14)
 *       at async Object.fetch (worker.js:102432:30)
 *
 *     GET /robots.txt  ->  HTTP 500, "error code: 1101"
 *
 * Read from `wrangler tail --format json` against the live deploy, not inferred.
 *
 * ## Why this had never fired
 *
 * Every response the function had ever been handed was one the framework constructed itself, and
 * those are mutable. The two paths that hand it a FOREIGN response are the Cloudflare asset branches
 * — `env.ASSETS.fetch(request)` — and until the `run_worker_first` fix landed in the same session,
 * Cloudflare's asset handler answered those requests before the worker ran. The line existed, was
 * shipped, and was unreachable.
 *
 * ## Why this is not a Cloudflare defect
 *
 * `withSecurityHeaders` lives in `adapters/security-headers.ts` and is shared by all six deploy
 * targets. Any of them that wraps a response obtained from `fetch()` — a proxy, an upstream call, a
 * CDN passthrough — hits the same guard. The fix is in the shared function, so the test is about the
 * function rather than about the worker.
 *
 * ## The fixture is proved armed before it is trusted
 *
 * A stub that merely *looks* immutable would let every case below pass on the unfixed code, which is
 * the failure mode this repository keeps measuring. The first case asserts the guard throws.
 */
import { describe, expect, it } from 'vitest'

import { withSecurityHeaders } from '../../packages/theo/src/adapters/security-headers.js'

const HEADERS = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
} as const

/**
 * A Response with the guard the platform applies to one it produced itself.
 *
 * Node's `Response` is mutable whatever its origin, so the condition cannot be reproduced by
 * fetching something — it has to be installed. The proxy throws the platform's exact message, so a
 * failure here reads the same as the failure in production.
 */
function immutableResponse(body: string | null, init?: ResponseInit): Response {
  const response = new Response(body, init)
  const frozen = new Headers(response.headers)

  Object.defineProperty(response, 'headers', {
    configurable: true,
    value: new Proxy(frozen, {
      get(target, property, receiver) {
        if (property === 'set' || property === 'append' || property === 'delete') {
          return () => {
            throw new TypeError("Can't modify immutable headers.")
          }
        }
        const value = Reflect.get(target, property, receiver) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    }),
  })

  return response
}

describe('withSecurityHeaders survives a response it did not create', () => {
  it('test_the_fixture_is_actually_immutable', () => {
    // COUNTERPROOF FIRST, and it is the load-bearing case. Every assertion below is satisfied by a
    // mutable stub on the UNFIXED function, so without this the whole file is green theatre.
    const response = immutableResponse('x')

    expect(() => {
      response.headers.set('x-frame-options', 'DENY')
    }).toThrow("Can't modify immutable headers.")
  })

  it('test_an_immutable_response_does_not_throw', () => {
    const response = immutableResponse('static file body')

    expect(
      () => withSecurityHeaders(response, HEADERS),
      'withSecurityHeaders mutates a response it does not own, which throws on Workers and ' +
        'returns HTTP 500 (error 1101) for every static file the worker forwards',
    ).not.toThrow()
  })

  it('test_the_headers_reach_the_returned_response', () => {
    // Not throwing is half of it: a `try {} catch {}` would satisfy the case above and drop the
    // headers the function exists to add — the silent-swallow failure `error-handling.md` forbids.
    const result = withSecurityHeaders(immutableResponse('body'), HEADERS)

    expect(result.headers.get('x-frame-options')).toBe('DENY')
    expect(result.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('test_the_body_and_status_survive', async () => {
    // Rebuilding a Response is the obvious fix and the obvious way to lose everything around the
    // headers. A 404 answered as 200, or an empty body, is worse than the exception it replaced.
    const result = withSecurityHeaders(
      immutableResponse('the asset bytes', { status: 404, statusText: 'Not Found' }),
      HEADERS,
    )

    expect(result.status).toBe(404)
    expect(await result.text()).toBe('the asset bytes')
  })

  it('test_headers_the_response_already_carried_are_kept', () => {
    // An asset response arrives with its own content-type. Dropping it would make the browser sniff
    // a stylesheet, which `x-content-type-options: nosniff` then refuses to load.
    const result = withSecurityHeaders(
      immutableResponse('body', { headers: { 'content-type': 'text/css' } }),
      HEADERS,
    )

    expect(result.headers.get('content-type')).toBe('text/css')
  })

  it('test_an_existing_value_is_not_overwritten', () => {
    // The pre-existing contract: the loop only set a header the response did not already have. A
    // rewrite that sets unconditionally would silently change a deliberate per-route value.
    const result = withSecurityHeaders(
      immutableResponse('body', { headers: { 'x-frame-options': 'SAMEORIGIN' } }),
      HEADERS,
    )

    expect(result.headers.get('x-frame-options')).toBe('SAMEORIGIN')
  })

  it('test_a_mutable_response_is_still_handled', () => {
    // The path every one of the six targets already took. It must not regress, and it is what the
    // whole suite has been exercising until now.
    const result = withSecurityHeaders(new Response('body', { status: 201 }), HEADERS)

    expect(result.status).toBe(201)
    expect(result.headers.get('x-frame-options')).toBe('DENY')
  })

  it('test_a_null_body_status_is_not_given_a_body', async () => {
    // `new Response(body, { status: 204 })` THROWS when the body is non-null, so a naive rebuild
    // turns an empty 204 into a different exception in the same place. 304 is the one an asset
    // handler actually returns, on a conditional request.
    const result = withSecurityHeaders(immutableResponse(null, { status: 204 }), HEADERS)

    expect(result.status).toBe(204)
    expect(await result.text()).toBe('')
    expect(result.headers.get('x-frame-options')).toBe('DENY')
  })
})
