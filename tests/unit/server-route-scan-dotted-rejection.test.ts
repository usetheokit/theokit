/**
 * G6 T1.1 — RED → GREEN: scanner REJECTS dotted basenames with
 * `RouterConventionError` and emits an actionable error message.
 *
 * Plan: .claude/knowledge-base/plans/g6-router-convention-plan.md v1.1
 *
 * Contract:
 *   1. Dotted middle-param basename throws RouterConventionError.
 *   2. Dotted trailing-only basename throws RouterConventionError.
 *   3. Error message contains file path + directory-nested suggestion + migration URL.
 *   4. Co-located `.test.ts` / `.spec.ts` files are silently skipped (EC-4).
 *   5. Directory-nested form (no dots in basename) scans normally — no false-positive.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { scanServerRoutes } from '../../packages/theo/src/server/scan/scan.js'
import {
  RouterConventionError,
  ROUTER_MIGRATION_GUIDE_URL,
} from '../../packages/theo/src/server/scan/errors.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let serverDir: string

beforeEach(() => {
  const base = join(
    tmpdir(),
    `theo-g6-dotted-rejection-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  serverDir = join(base, 'server')
  mkdirSync(join(serverDir, 'routes'), { recursive: true })
})

function touch(relativePath: string, content = 'export const GET = { handler: () => ({}) }') {
  const full = join(serverDir, 'routes', relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

describe('G6 T1.1 — RouterConventionError on dotted basenames', () => {
  it('test_dotted_middle_param_throws: auth.[provider].login.ts triggers RouterConventionError', () => {
    touch('auth.[provider].login.ts')
    expect(() => scanServerRoutes(serverDir)).toThrow(RouterConventionError)
  })

  it('test_dotted_trailing_only_throws: posts.[id].ts triggers RouterConventionError', () => {
    touch('posts.[id].ts')
    expect(() => scanServerRoutes(serverDir)).toThrow(RouterConventionError)
  })

  it('test_error_message_contains_file_path_and_suggestion_and_url', () => {
    touch('auth.[provider].login.ts')
    let caught: unknown
    try {
      scanServerRoutes(serverDir)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(RouterConventionError)
    const error = caught as RouterConventionError
    expect(error.file).toContain('auth.[provider].login.ts')
    // Suggestion = directory-nested form, dots split outside brackets
    expect(error.suggestion).toContain('auth/[provider]/login.ts')
    expect(error.migrationUrl).toBe(ROUTER_MIGRATION_GUIDE_URL)
    expect(error.message).toContain('theokit migrate router')
    expect(error.message).toContain(ROUTER_MIGRATION_GUIDE_URL)
  })

  it('test_colocated_test_file_silently_skipped: posts/[id].test.ts does NOT trigger rejection', () => {
    // EC-4: tests co-located with routes must be silently skipped by the scanner,
    // BEFORE the dotted-basename check runs. `posts/[id].test.ts` would otherwise
    // be a dotted-basename violation (extension strip leaves `posts/[id].test`,
    // which has a dot outside brackets).
    touch('posts/[id].ts')
    touch('posts/[id].test.ts')
    touch('posts/[id].spec.ts')
    const routes = scanServerRoutes(serverDir)
    // Only the real route is registered; tests + specs filtered out.
    expect(routes).toHaveLength(1)
    expect(routes[0]!.routePath).toBe('/api/posts/:id')
    expect(routes[0]!.paramNames).toEqual(['id'])
  })

  it('test_directory_nested_form_scans_normally: no false-positive on legitimate routes', () => {
    touch('auth/[provider]/login.ts')
    touch('posts/[id].ts')
    touch('users/[...rest].ts')
    touch('index.ts')
    const routes = scanServerRoutes(serverDir)
    expect(routes).toHaveLength(4)
    // Static (index) first → dynamic → catch-all last
    expect(routes.map((r) => r.routePath)).toEqual([
      '/api/',
      '/api/auth/:provider/login',
      '/api/posts/:id',
      '/api/users/:...rest',
    ])
    // `provider` IS extracted now (was the original bug)
    const authRoute = routes.find((r) => r.routePath === '/api/auth/:provider/login')!
    expect(authRoute.paramNames).toContain('provider')
  })
})
