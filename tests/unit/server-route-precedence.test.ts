import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { scanServerRoutes } from '../../packages/theo/src/server/scan/scan.js'
import { matchRoute } from '../../packages/theo/src/server/scan/match.js'

/**
 * B-006 / usetheokit/theokit#348 — route precedence is decided by the order
 * `scanServerRoutes` returns, because `matchRoute` returns on the first pattern
 * that matches. The tiebreak compared the WHOLE path with `localeCompare`, so
 * `/api/:resource/settings` sorted ahead of `/api/users/:id` (`:` < `u`) and a
 * request for `/api/users/settings` was dispatched to the generic handler.
 *
 * That is not a cosmetic ordering defect: an authorization check placed on the
 * specific route is bypassed when the generic route wins.
 *
 * Precedence is compared PER SEGMENT — static beats dynamic beats catch-all at
 * the first segment where they differ — which is the rule the URL itself
 * expresses. A whole-path comparison cannot express it, because it compares
 * characters across segment boundaries.
 */

let serverDir: string

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'theo-route-precedence-'))
  serverDir = join(base, 'server')
  mkdirSync(join(serverDir, 'routes'), { recursive: true })
})

function touch(
  relativePath: string,
  content = "export const GET = { policy: 'public', handler: () => ({}) }",
) {
  const full = join(serverDir, 'routes', relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

describe('server route precedence (B-006)', () => {
  it('test_specific_static_segment_wins_over_earlier_dynamic_segment', () => {
    touch('[resource]/settings.ts')
    touch('users/[id].ts')

    const routes = scanServerRoutes(serverDir)
    const matched = matchRoute('/api/users/settings', routes)

    expect(matched).not.toBeNull()
    expect(matched?.route.routePath).toBe('/api/users/:id')
    expect(matched?.params).toEqual({ id: 'settings' })
  })

  it('test_precedence_is_per_segment_not_whole_path_comparison', () => {
    touch('[resource]/settings.ts')
    touch('users/[id].ts')

    const paths = scanServerRoutes(serverDir).map((r) => r.routePath)

    // A whole-path `localeCompare` puts '/api/:resource/settings' first because
    // ':' precedes 'u'. Per-segment comparison puts the static 'users' first.
    expect(paths.indexOf('/api/users/:id')).toBeLessThan(paths.indexOf('/api/:resource/settings'))
  })

  it('test_catch_all_yields_to_a_static_segment_at_the_same_position', () => {
    touch('[...rest].ts')
    touch('users/[id].ts')

    const routes = scanServerRoutes(serverDir)
    const matched = matchRoute('/api/users/42', routes)

    expect(matched?.route.routePath).toBe('/api/users/:id')
  })

  it('test_fully_static_route_wins_over_a_dynamic_one_it_collides_with', () => {
    touch('users/[id].ts')
    touch('users/me.ts')

    const routes = scanServerRoutes(serverDir)
    const matched = matchRoute('/api/users/me', routes)

    expect(matched?.route.routePath).toBe('/api/users/me')
  })

  it('test_exact_route_wins_over_a_catch_all_that_extends_it', () => {
    touch('users/[...rest].ts')
    touch('users.ts')

    const routes = scanServerRoutes(serverDir)

    expect(routes[0].routePath).toBe('/api/users')
    expect(matchRoute('/api/users', routes)?.route.routePath).toBe('/api/users')
  })

  it('test_ordering_does_not_depend_on_the_locale_the_process_runs_under', () => {
    touch('users/[id].ts')
    touch('users/me.ts')
    touch('[resource]/settings.ts')

    const first = scanServerRoutes(serverDir).map((r) => r.routePath)
    const second = scanServerRoutes(serverDir).map((r) => r.routePath)

    expect(first).toEqual(second)
  })
})
