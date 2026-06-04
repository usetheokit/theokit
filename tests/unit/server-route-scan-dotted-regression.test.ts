/**
 * G6 T0.1 — RED regression test for the dotted-path scanner bug.
 *
 * Plan: .claude/knowledge-base/plans/g6-router-convention-plan.md v1.1
 *
 * Bug observed during G11 implementation 2026-06-04 madrugada:
 *   `auth.[provider].login.ts` produces routePath `/auth.:provider.login` where
 *   `compilePattern` parses the segment `:provider.login` as a single param
 *   name (with literal text in it), NOT extracting `provider` cleanly. Result:
 *   `params.provider === undefined` at request time.
 *
 * This test asserts the CURRENT (broken) behavior in Phase 0. In Phase 1
 * T1.1, the scanner will REJECT dotted basenames with `RouterConventionError`,
 * at which point this test is inverted to expect the explicit error.
 *
 * Status before T1.1: RED (assertion fails on scanner that incorrectly succeeds)
 * Status after T1.1: GREEN (this file is updated to expect RouterConventionError)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { scanServerRoutes } from '../../packages/theo/src/server/scan/scan.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let serverDir: string

beforeEach(() => {
  const base = join(
    tmpdir(),
    `theo-g6-dotted-regression-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  serverDir = join(base, 'server')
  mkdirSync(join(serverDir, 'routes'), { recursive: true })
})

function touch(relativePath: string, content = 'export const GET = { handler: () => ({}) }') {
  const full = join(serverDir, 'routes', relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

describe('G6 T0.1 — dotted-path regression (RED before Phase 1 T1.1)', () => {
  it('test_dotted_middle_param_silently_drops: auth.[provider].login.ts paramNames does NOT contain "provider"', () => {
    touch('auth.[provider].login.ts')
    const routes = scanServerRoutes(serverDir)
    expect(routes).toHaveLength(1)
    const route = routes[0]!

    // The scanner SHOULD extract `provider` as a path param. Bug: it does not —
    // the regex matches `:provider.login` as a single param name containing
    // literal `.login`. Asserting the BROKEN behavior to document the bug.
    expect(route.paramNames).not.toContain('provider')

    // Documenting what the current scanner DOES produce (broken):
    //   routePath: '/api/auth.:provider.login' (scanner prefixes with /api)
    //   paramNames: ['provider.login']  (a single param-key with literal dot)
    expect(route.routePath).toBe('/api/auth.:provider.login')
    expect(route.paramNames).toEqual(['provider.login'])
  })

  it('test_dotted_trailing_only_param_also_silently_broken: posts.[id].ts produces wrong paramNames', () => {
    touch('posts.[id].ts')
    const routes = scanServerRoutes(serverDir)
    expect(routes).toHaveLength(1)
    const route = routes[0]!

    // Even the "trailing-only" dotted convention is broken — the dot stays
    // literal in the route path. The user expected `/api/posts/:id` but the
    // scanner produces `/api/posts.:id`.
    expect(route.routePath).toBe('/api/posts.:id')

    // paramNames contains 'id' but the URL pattern is `/api/posts.X` (literal
    // dot), not `/api/posts/X`. So a request to `/api/posts/42` would NOT match.
    expect(route.paramNames).toEqual(['id'])
  })
})
