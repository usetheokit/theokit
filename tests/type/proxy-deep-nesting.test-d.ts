/**
 * G1 type-test hardening — Gap 4 (Proxy deep-nesting) per
 * `plans/g1-type-test-hardening-plan.md` v1.0 T2.
 *
 * G1's Proxy supports arbitrary property-access chains. These tests pin the
 * generic resolution so consumer-typed multi-segment paths
 * (`client.api.v2.posts.[id].comments.[cid].get`) keep their typing.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { createAppClient } from 'theokit/client'

interface DeeplyNestedApi {
  api: {
    v2: {
      posts: {
        get: (opts?: { params?: { id: string } }) => Promise<{ id: string; title: string }>
        comments: {
          post: (opts: {
            params: { postId: string; cid: string }
            body: { text: string }
          }) => Promise<{ ok: true }>
        }
      }
    }
  }
}

describe('createAppClient — deep nesting (4-level chain)', () => {
  it('client.api.v2 resolves to typed sub-object', () => {
    const client = createAppClient<DeeplyNestedApi>()
    expectTypeOf(client.api.v2).toEqualTypeOf<DeeplyNestedApi['api']['v2']>()
  })

  it('client.api.v2.posts.get is a callable function', () => {
    const client = createAppClient<DeeplyNestedApi>()
    expectTypeOf(client.api.v2.posts.get).toBeFunction()
  })

  it('deep call site params are typed correctly (params.postId + params.cid)', () => {
    const client = createAppClient<DeeplyNestedApi>()
    expectTypeOf(client.api.v2.posts.comments.post).parameter(0).toEqualTypeOf<{
      params: { postId: string; cid: string }
      body: { text: string }
    }>()
  })

  it('deep call return type is inferred all the way through', () => {
    type DeepPostFn = DeeplyNestedApi['api']['v2']['posts']['comments']['post']
    type DeepReturn = Awaited<ReturnType<DeepPostFn>>
    expectTypeOf<DeepReturn>().toEqualTypeOf<{ ok: true }>()
  })
})
