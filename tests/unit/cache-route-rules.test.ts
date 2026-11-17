import { describe, it, expect } from 'vitest'

import { compileRouteRules, resolveRouteRule } from '../../packages/theo/src/cache/route-rules.js'

describe('compileRouteRules + resolveRouteRule', () => {
  it('matches glob pattern', () => {
    const compiled = compileRouteRules({ '/api/**': { maxAge: 60 } })
    expect(resolveRouteRule('/api/users', compiled)).toEqual({ maxAge: 60 })
  })

  it('returns undefined when no match', () => {
    const compiled = compileRouteRules({ '/api/**': { maxAge: 60 } })
    expect(resolveRouteRule('/about', compiled)).toBeUndefined()
  })

  it('first-match-wins (insertion order)', () => {
    const compiled = compileRouteRules({
      '/api/**': { maxAge: 30 },
      '/api/users': { maxAge: 60 },
    })
    expect(resolveRouteRule('/api/users', compiled)).toEqual({ maxAge: 30 })
  })

  it('maxAge: 0 rule is preserved (caller decides to disable)', () => {
    const compiled = compileRouteRules({
      '/api/realtime/**': { maxAge: 0 },
    })
    expect(resolveRouteRule('/api/realtime/sse', compiled)).toEqual({
      maxAge: 0,
    })
  })

  it('preserves swr + tags in matched rule', () => {
    const compiled = compileRouteRules({
      '/api/**': { maxAge: 60, swr: 300, tags: ['api'] },
    })
    expect(resolveRouteRule('/api/x', compiled)).toEqual({
      maxAge: 60,
      swr: 300,
      tags: ['api'],
    })
  })

  it('EC-5: complex glob patterns work ', () => {
    const compiled = compileRouteRules({
      '/api/{users,posts}/**/*.json': { maxAge: 60 },
    })
    expect(resolveRouteRule('/api/users/42/profile.json', compiled)).toEqual({
      maxAge: 60,
    })
    expect(resolveRouteRule('/api/posts/abc/x.json', compiled)).toEqual({
      maxAge: 60,
    })
    expect(resolveRouteRule('/api/users/42/profile.html', compiled)).toBeUndefined()
  })

  it('matches dotfiles, ?, and zero-segment **', () => {
    const compiled = compileRouteRules({ '/a/**/b?.txt': { maxAge: 1 } })
    expect(resolveRouteRule('/a/b1.txt', compiled)).toBeDefined()
    expect(resolveRouteRule('/a/.x/y/b2.txt', compiled)).toBeDefined()
    expect(resolveRouteRule('/a/b12.txt', compiled)).toBeUndefined()
  })

  it('treats extglob syntax literally and does not backtrack exponentially', () => {
    const compiled = compileRouteRules({ '+(*a)': { maxAge: 1 } })
    const start = Date.now()
    expect(resolveRouteRule('a'.repeat(40) + '!', compiled)).toBeUndefined()
    expect(Date.now() - start).toBeLessThan(500)
  })
})
