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
import { defineRoute } from 'theokit/server'
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
