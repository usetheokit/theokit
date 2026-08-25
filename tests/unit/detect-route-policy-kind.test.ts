/**
 * The scanner knows WHICH methods declare a policy. It did not know WHAT they declared, and the
 * difference is the whole of ADR 0001's second half: `policy('public')` and `policy(requireOwner)`
 * are both declarations, and only one of them protects anything.
 *
 * Nothing could ask "is this route open?" without loading the module, so nothing did — which is why
 * an app could bind every network interface while every one of its write routes was unauthenticated,
 * and no gate anywhere was in a position to notice.
 */
import { describe, it, expect } from 'vitest'

import { detectRoutePolicyKinds } from '../../packages/theo/src/server/scan/detect-route-policy.js'

const at = (src: string) => detectRoutePolicyKinds('/fake/route.ts', src)

describe('detectRoutePolicyKinds — public literal vs a real guard', () => {
  it('reads the builder form', () => {
    const kinds = at(`
      import { route } from 'theokit/server/define'
      export const GET = route().policy('public').handler(() => ({})).build()
      export const POST = route().policy(({ subject }) => subject !== null).handler(() => ({})).build()
    `)
    expect(kinds.get('GET')).toBe('public')
    expect(kinds.get('POST')).toBe('guarded')
  })

  it('reads the object form', () => {
    const kinds = at(`
      export const GET = defineRoute({ policy: 'public', handler: () => ({}) })
      export const DELETE = defineRoute({ policy: requireOwner, handler: () => ({}) })
    `)
    expect(kinds.get('GET')).toBe('public')
    expect(kinds.get('DELETE')).toBe('guarded')
  })

  it('is not fooled by a chain that puts .policy before other links', () => {
    const kinds = at(`
      export const PUT = route().body(schema).policy('public').handler(fn).build()
    `)
    expect(kinds.get('PUT')).toBe('public')
  })

  it('omits a method that declares nothing — absence is not "public"', () => {
    const kinds = at(`export const GET = route().handler(() => ({})).build()`)
    expect(kinds.has('GET')).toBe(false)
  })

  it('treats an unreadable declaration as guarded, never as public', () => {
    // `policy: POLICIES.admin` cannot be resolved by an AST pass. Guessing "public" here would
    // report an open route as open by accident and a protected one as open by mistake; only the
    // second is dangerous, so the unreadable case takes the safe label.
    const kinds = at(`export const POST = route().policy(POLICIES.admin).handler(fn).build()`)
    expect(kinds.get('POST')).toBe('guarded')
  })

  it('resolves the local-const re-export form the sibling detector already supports', () => {
    const kinds = at(`
      const handler = route().policy('public').handler(fn).build()
      export { handler as GET }
    `)
    expect(kinds.get('GET')).toBe('public')
  })
})
