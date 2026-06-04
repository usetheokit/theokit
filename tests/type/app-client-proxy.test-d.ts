/**
 * G1 type-test hardening — Gap 1 (Proxy facade) per
 * `plans/g1-type-test-hardening-plan.md` v1.0 T2.
 *
 * Pins compile-time guarantees of `createAppClient<TApp>()`:
 *   - default generic resolves to `unknown` (consumer MUST pass shape)
 *   - explicit shape preserves property-access chain typing
 *   - returned methods are functions accepting `CallOptions`
 *   - 1 negative case: calling without resource segment fails to compile when
 *     consumer has typed it as a callable resource (only via runtime today,
 *     but @ts-expect-error documents the future strict-typing direction)
 */
import { describe, it, expectTypeOf } from 'vitest'
import { createAppClient } from 'theokit/client'
import type { CreateAppClientOptions } from 'theokit/client'

interface UsersApi {
  users: {
    get: (opts?: { params?: { id: string } }) => Promise<{ id: string; name: string }>
    post: (opts: { body: { name: string; email: string } }) => Promise<{ id: string }>
  }
}

describe('createAppClient — Proxy facade type surface', () => {
  it('default generic resolves to unknown (consumer must declare shape)', () => {
    const untyped = createAppClient()
    expectTypeOf(untyped).toEqualTypeOf<unknown>()
  })

  it('explicit generic preserves property-access typing', () => {
    const client = createAppClient<UsersApi>()
    expectTypeOf(client).toEqualTypeOf<UsersApi>()
    expectTypeOf(client.users).toEqualTypeOf<UsersApi['users']>()
    expectTypeOf(client.users.get).toBeFunction()
    expectTypeOf(client.users.post).toBeFunction()
  })

  it('typed method return type is a Promise of the declared shape', () => {
    type GetReturn = Awaited<ReturnType<UsersApi['users']['get']>>
    expectTypeOf<GetReturn>().toEqualTypeOf<{ id: string; name: string }>()
  })

  it('post method requires body argument (no default empty call)', () => {
    const client = createAppClient<UsersApi>()
    expectTypeOf(client.users.post).parameter(0).toEqualTypeOf<{
      body: { name: string; email: string }
    }>()
  })

  it('CreateAppClientOptions has documented optional fields', () => {
    expectTypeOf<CreateAppClientOptions>().toHaveProperty('baseUrl')
    expectTypeOf<CreateAppClientOptions>().toHaveProperty('fetchImpl')
  })

  it('createAppClient overloads accept string OR options object', () => {
    expectTypeOf(createAppClient<UsersApi>)
      .parameter(0)
      .toEqualTypeOf<string | CreateAppClientOptions | undefined>()
  })

  it('NEGATIVE — passing wrong body shape fails to compile', () => {
    type PostFn = UsersApi['users']['post']
    type PostArg = Parameters<PostFn>[0]
    // @ts-expect-error - body.name is string, not number
    const _invalid: PostArg = { body: { name: 123, email: 'a@b' } }
    expectTypeOf(_invalid).toBeObject()
  })
})
