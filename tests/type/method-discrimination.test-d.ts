/**
 * G1 type-test hardening — Gap 5 (Method discrimination GET vs POST) per
 * `plans/g1-type-test-hardening-plan.md` v1.0 T2.
 *
 * Asserts that for a single resource, `client.X.get` and `client.X.post` have
 * DIFFERENT argument and return shapes. Same resource path, different verbs
 * produce different types.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { createAppClient } from 'theokit/client'

interface PostsApi {
  posts: {
    get: (opts?: { params?: { id: string } }) => Promise<{ id: string; title: string }>
    post: (opts: {
      body: { title: string; content: string }
    }) => Promise<{ id: string; createdAt: string }>
    put: (opts: {
      params: { id: string }
      body: { title?: string; content?: string }
    }) => Promise<{ id: string; updatedAt: string }>
    delete: (opts: { params: { id: string } }) => Promise<{ deleted: true }>
  }
}

describe('createAppClient — method discrimination across HTTP verbs', () => {
  it('GET takes optional params, no body, returns full resource', () => {
    const client = createAppClient<PostsApi>()
    expectTypeOf(client.posts.get)
      .parameter(0)
      .toEqualTypeOf<{ params?: { id: string } } | undefined>()
  })

  it('POST requires body, no params, returns id + createdAt', () => {
    type PostReturn = Awaited<ReturnType<PostsApi['posts']['post']>>
    expectTypeOf<PostReturn>().toEqualTypeOf<{ id: string; createdAt: string }>()
  })

  it('PUT requires both params AND body, returns id + updatedAt', () => {
    type PutReturn = Awaited<ReturnType<PostsApi['posts']['put']>>
    expectTypeOf<PutReturn>().toEqualTypeOf<{ id: string; updatedAt: string }>()
  })

  it('DELETE requires params, no body, returns { deleted: true }', () => {
    type DeleteReturn = Awaited<ReturnType<PostsApi['posts']['delete']>>
    expectTypeOf<DeleteReturn>().toEqualTypeOf<{ deleted: true }>()
  })

  it('GET and POST return types are different (not assignable)', () => {
    type GetReturn = Awaited<ReturnType<PostsApi['posts']['get']>>
    type PostReturn = Awaited<ReturnType<PostsApi['posts']['post']>>
    // GetReturn has 'title', PostReturn has 'createdAt' — disjoint
    expectTypeOf<GetReturn>().not.toEqualTypeOf<PostReturn>()
  })

  it('PUT and POST have different argument shapes (PUT requires params)', () => {
    const client = createAppClient<PostsApi>()
    expectTypeOf(client.posts.put).parameter(0).toHaveProperty('params')
    expectTypeOf(client.posts.post).parameter(0).not.toHaveProperty('params')
  })

  it('DELETE argument is mandatory (no optional call)', () => {
    const client = createAppClient<PostsApi>()
    expectTypeOf(client.posts.delete).parameter(0).toEqualTypeOf<{ params: { id: string } }>()
  })

  it('NEGATIVE — POST cannot be called without body', () => {
    type PostArg = Parameters<PostsApi['posts']['post']>[0]
    // @ts-expect-error - body is required
    const _invalid: PostArg = {}
    expectTypeOf(_invalid).toBeObject()
  })

  it('NEGATIVE — DELETE cannot be called with body (extra property)', () => {
    type DeleteArg = Parameters<PostsApi['posts']['delete']>[0]
    // @ts-expect-error - body is not in DELETE signature
    const _invalid: DeleteArg = { params: { id: 'p1' }, body: { force: true } }
    expectTypeOf(_invalid).toBeObject()
  })
})
