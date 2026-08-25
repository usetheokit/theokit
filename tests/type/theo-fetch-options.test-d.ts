/**
 * G1 type-test hardening — Gap 2 (TheoFetchOptions<T> discrimination) per
 * `plans/g1-type-test-hardening-plan.md` v1.0 T2.
 *
 * `TheoFetchOptions<T>` is a conditional intersection:
 *   - `query` field is `never` when route has no query schema (no `query?` key)
 *   - `query` field is REQUIRED when route declares a query schema
 *   - same shape for `body`
 *
 * These tests pin the discrimination so a future refactor of the conditional
 * intersection (`InferQuery<T> extends undefined ? ...`) cannot silently
 * regress the type narrowing.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { defineRoute } from '../../packages/theo/src/server/define/define-route.js'
import type { TheoFetchOptions, InferQuery, InferBody } from 'theokit/client'
import { z } from 'zod'

const _GET_no_query = defineRoute({
  handler: () => ({ ok: true }),
})
type GET_no_query = typeof _GET_no_query

const _GET_with_query = defineRoute({
  query: z.object({ search: z.string(), page: z.number() }),
  handler: ({ query: _q }) => ({ results: [] as string[] }),
})
type GET_with_query = typeof _GET_with_query

const _POST_with_body = defineRoute({
  body: z.object({ name: z.string(), email: z.string() }),
  handler: ({ body: _b }) => ({ id: 'new' }),
})
type POST_with_body = typeof _POST_with_body

const _POST_with_query_and_body = defineRoute({
  query: z.object({ tenant: z.string() }),
  body: z.object({ payload: z.string() }),
  handler: ({ query: _q, body: _b }) => ({ ok: true }),
})
type POST_both = typeof _POST_with_query_and_body

/**
 * A querystring flag with a default and a transform — the shape usetheokit/theokit#490 was about.
 *
 * Everything on a querystring is a string, so a boolean flag has to be declared as the strings it
 * can arrive as and transformed after. `z.coerce.boolean()` cannot do it: `Boolean('false')` is
 * `true`, so the flag would never turn off.
 */
const _GET_flag = defineRoute({
  query: z.object({
    status: z.enum(['captured', 'triaged']).optional(),
    clustered: z
      .enum(['true', 'false', '1', '0'])
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
  }),
  handler: ({ query: _q }) => ({ items: [] as string[] }),
})
type GET_flag = typeof _GET_flag

/** A body with a defaulted field — same question, on the other side of the request. */
const _POST_defaulted_body = defineRoute({
  body: z.object({ name: z.string(), tags: z.array(z.string()).default([]) }),
  handler: ({ body: _b }) => ({ id: 'new' }),
})
type POST_defaulted_body = typeof _POST_defaulted_body

describe('TheoFetchOptions<T> — discrimination on query/body presence', () => {
  it('GET without query schema: TheoFetchOptions has query field undefined (key may not be set)', () => {
    type Opts = TheoFetchOptions<GET_no_query>
    expectTypeOf<Opts['query']>().toEqualTypeOf<undefined>()
  })

  it('GET with query schema: TheoFetchOptions REQUIRES query field of inferred shape', () => {
    type Opts = TheoFetchOptions<GET_with_query>
    expectTypeOf<Opts['query']>().toEqualTypeOf<{ search: string; page: number }>()
  })

  it('GET with query schema: query field shape matches InferQuery<T>', () => {
    type Opts = TheoFetchOptions<GET_with_query>
    expectTypeOf<Opts['query']>().toEqualTypeOf<InferQuery<GET_with_query>>()
  })

  it('POST without body schema: body field is undefined (must not be set)', () => {
    type Opts = TheoFetchOptions<GET_no_query>
    expectTypeOf<Opts['body']>().toEqualTypeOf<undefined>()
  })

  it('POST with body schema: TheoFetchOptions REQUIRES body field of inferred shape', () => {
    type Opts = TheoFetchOptions<POST_with_body>
    expectTypeOf<Opts['body']>().toEqualTypeOf<{ name: string; email: string }>()
  })

  it('POST with body schema: body field shape matches InferBody<T>', () => {
    type Opts = TheoFetchOptions<POST_with_body>
    expectTypeOf<Opts['body']>().toEqualTypeOf<InferBody<POST_with_body>>()
  })

  it('POST with BOTH query and body: both fields required', () => {
    type Opts = TheoFetchOptions<POST_both>
    expectTypeOf<Opts['query']>().toEqualTypeOf<{ tenant: string }>()
    expectTypeOf<Opts['body']>().toEqualTypeOf<{ payload: string }>()
  })

  it('TheoFetchOptions inherits RequestInit fields (signal/headers/etc)', () => {
    type Opts = TheoFetchOptions<GET_no_query>
    expectTypeOf<Opts>().toHaveProperty('signal')
    expectTypeOf<Opts>().toHaveProperty('headers')
  })

  // usetheokit/theokit#465 — `method` was omitted from the options type while `buildRequestInit`
  // read `opts.method` and defaulted to GET. So the documented POST call did not compile, and the
  // call that DID compile sent a GET with a JSON body and no `X-Theo-Action` header: the POST route
  // was never reached, and nothing said so until someone opened the network panel.
  it('accepts an explicit method on a route with no body schema', () => {
    const _opts: TheoFetchOptions<GET_no_query> = { method: 'DELETE' }
    expectTypeOf(_opts).toBeObject()
  })

  it('REQUIRES a method when the route declares a body — the silent GET is what this prevents', () => {
    const _ok: TheoFetchOptions<POST_with_body> = {
      method: 'POST',
      body: { name: 'ada', email: 'a@b.test' },
    }
    expectTypeOf(_ok).toBeObject()

    // @ts-expect-error - a body without a method used to compile and go out as GET
    const _missing: TheoFetchOptions<POST_with_body> = { body: { name: 'ada', email: 'a@b.test' } }
    expectTypeOf(_missing).toBeObject()
  })

  it('NEGATIVE — a body route cannot declare a safe method', () => {
    // Single line on purpose: `@ts-expect-error` suppresses the NEXT line only, and TypeScript
    // reports a bad property on the property's own line, not on the declaration's.
    // prettier-ignore
    // @ts-expect-error - GET carries no body; `buildRequestInit` skips the CSRF header for it
    const _opts: TheoFetchOptions<POST_with_body> = { method: 'GET', body: { name: 'ada', email: 'a@b.test' } }
    expectTypeOf(_opts).toBeObject()
  })

  it('NEGATIVE — a misspelled method fails to compile', () => {
    // @ts-expect-error - not a member of HttpMethod
    const _opts: TheoFetchOptions<GET_no_query> = { method: 'POTS' }
    expectTypeOf(_opts).toBeObject()
  })

  it('NEGATIVE — passing wrong query shape (number where string) fails to compile', () => {
    // @ts-expect-error - search must be string, not boolean
    const _opts: TheoFetchOptions<GET_with_query> = { query: { search: true, page: 1 } }
    expectTypeOf(_opts).toBeObject()
  })

  it('NEGATIVE — passing body to a no-body route fails to compile', () => {
    // @ts-expect-error - GET_no_query has no body schema; body field is `never`
    const _opts: TheoFetchOptions<GET_no_query> = { body: { anything: 1 } }
    expectTypeOf(_opts).toBeObject()
  })
})

/**
 * The caller sends the INPUT — usetheokit/theokit#490.
 *
 * `InferQuery`/`InferBody` used `z.infer`, which is `z.output`: the value the handler receives
 * after parsing. A client sends what goes on the wire, before defaults are filled and transforms
 * run. Typing the request with the output made two correct schemas uncallable:
 *
 *   - a `.default()` field became required at the call site;
 *   - a `.transform()` field asked for the post-transform type — a `boolean` for a value that has
 *     to travel as a string.
 *
 * For a schema with neither, input and output are the same type, which is why every test above
 * this block passes unchanged and why the defect stayed invisible until a schema used them.
 */
describe('InferQuery/InferBody describe what the caller sends, not what the handler receives', () => {
  it('a defaulted query field is OPTIONAL — that is what a default means', () => {
    const _omitted: TheoFetchOptions<GET_flag> = { query: {} }
    expectTypeOf(_omitted).toBeObject()

    const _partial: TheoFetchOptions<GET_flag> = { query: { status: 'captured' } }
    expectTypeOf(_partial).toBeObject()
  })

  it('a transformed query field takes the value that travels, not the parsed one', () => {
    const _wire: TheoFetchOptions<GET_flag> = { query: { clustered: 'false' } }
    expectTypeOf(_wire).toBeObject()
  })

  it('NEGATIVE — the post-transform type is no longer accepted, because it never travels', () => {
    // @ts-expect-error - `clustered` reaches the server as a string; the boolean is what parsing produces
    const _parsed: TheoFetchOptions<GET_flag> = { query: { clustered: false } }
    expectTypeOf(_parsed).toBeObject()
  })

  it('NEGATIVE — a value outside the declared strings still fails', () => {
    // @ts-expect-error - 'maybe' is not one of the four accepted strings
    const _bad: TheoFetchOptions<GET_flag> = { query: { clustered: 'maybe' } }
    expectTypeOf(_bad).toBeObject()
  })

  it('a defaulted BODY field is optional too — a JSON body is serialised before it is parsed', () => {
    const _omitted: TheoFetchOptions<POST_defaulted_body> = {
      method: 'POST',
      body: { name: 'ada' },
    }
    expectTypeOf(_omitted).toBeObject()

    const _given: TheoFetchOptions<POST_defaulted_body> = {
      method: 'POST',
      body: { name: 'ada', tags: ['x'] },
    }
    expectTypeOf(_given).toBeObject()
  })

  it('a schema with no default and no transform is unchanged — input and output coincide', () => {
    expectTypeOf<InferQuery<GET_with_query>>().toEqualTypeOf<{ search: string; page: number }>()
    expectTypeOf<InferBody<POST_with_body>>().toEqualTypeOf<{ name: string; email: string }>()
  })
})
