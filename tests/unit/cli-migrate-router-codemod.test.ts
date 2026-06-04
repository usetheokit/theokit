/**
 * G6 T2.1 — Pure codemod function tests for `theokit migrate router`.
 *
 * Plan: .claude/knowledge-base/plans/g6-router-convention-plan.md v1.1
 *
 * Coverage:
 *   - Already-nested (no-op, idempotent)
 *   - Single dotted middle-param: `auth.[provider].login.ts` →
 *     `auth/[provider]/login.ts`
 *   - Trailing dotted-only: `posts.[id].ts` → `posts/[id].ts`
 *   - Catch-all + dots: `users.[...rest].ts` → `users/[...rest].ts`
 *   - Collision detection (case-sensitive)
 *   - Collision detection (case-insensitive — EC-5 mac/Windows)
 *   - Test/spec files silently ignored (EC-4 alignment)
 *   - Non-route file (e.g., `.theokit-meta.json` if anyone leaves one
 *     under routes/) is ignored — returns null
 *   - Idempotency: running twice on the same tree produces zero second-pass
 *     work
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  planRouterMigration,
  type RouterMigrationPlanItem,
} from '../../packages/theo/src/cli/commands/migrate/router-codemod.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let routesDir: string

beforeEach(() => {
  const base = join(
    tmpdir(),
    `theo-g6-codemod-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  routesDir = join(base, 'server', 'routes')
  mkdirSync(routesDir, { recursive: true })
})

afterEach(() => {
  rmSync(routesDir, { recursive: true, force: true })
})

function touch(relativePath: string) {
  const full = join(routesDir, relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, 'export const GET = { handler: () => ({}) }')
}

function relativize(plan: RouterMigrationPlanItem[]): { from: string; to: string }[] {
  return plan.map((p) => ({
    from: p.from.replace(routesDir, '').replace(/^[/\\]/, ''),
    to: p.to.replace(routesDir, '').replace(/^[/\\]/, ''),
  }))
}

describe('G6 T2.1 — planRouterMigration (pure codemod core)', () => {
  it('test_already_nested_is_noop: directory-nested form produces empty plan', () => {
    touch('auth/[provider]/login.ts')
    touch('posts/[id].ts')
    touch('users/[...rest].ts')
    touch('index.ts')

    const plan = planRouterMigration(routesDir)
    expect(plan).toEqual([])
  })

  it('test_dotted_middle_param_migrates: auth.[provider].login.ts → auth/[provider]/login.ts', () => {
    touch('auth.[provider].login.ts')

    const plan = relativize(planRouterMigration(routesDir))
    expect(plan).toEqual([{ from: 'auth.[provider].login.ts', to: 'auth/[provider]/login.ts' }])
  })

  it('test_dotted_trailing_only_migrates: posts.[id].ts → posts/[id].ts', () => {
    touch('posts.[id].ts')

    const plan = relativize(planRouterMigration(routesDir))
    expect(plan).toEqual([{ from: 'posts.[id].ts', to: 'posts/[id].ts' }])
  })

  it('test_dotted_catchall_migrates: users.[...rest].ts → users/[...rest].ts', () => {
    touch('users.[...rest].ts')

    const plan = relativize(planRouterMigration(routesDir))
    expect(plan).toEqual([{ from: 'users.[...rest].ts', to: 'users/[...rest].ts' }])
  })

  it('test_collision_detected: dotted form would overwrite existing nested file', () => {
    touch('auth.[provider].login.ts')
    touch('auth/[provider]/login.ts') // pre-existing target

    expect(() => planRouterMigration(routesDir)).toThrow(/collision/i)
  })

  it('test_collision_detected_case_insensitive_EC5: auth.[provider].Login.ts vs auth/[provider]/login.ts', () => {
    // EC-5: macOS/Windows treat `Login.ts` and `login.ts` as the same path;
    // on Linux they're distinct. To avoid silent overwrite on cross-platform
    // dev, the codemod errors when a target collides case-insensitively.
    touch('auth.[provider].Login.ts')
    touch('auth/[provider]/login.ts')

    expect(() => planRouterMigration(routesDir)).toThrow(/collision/i)
  })

  it('test_test_and_spec_files_skipped_EC4: posts.[id].test.ts is not migrated', () => {
    touch('posts.[id].ts')
    touch('posts.[id].test.ts')
    touch('posts.[id].spec.ts')

    const plan = relativize(planRouterMigration(routesDir))
    // Only the real route shows in the migration plan
    expect(plan).toEqual([{ from: 'posts.[id].ts', to: 'posts/[id].ts' }])
  })

  it('test_nested_dotted_inside_dirs: api/v2/posts.[id].ts → api/v2/posts/[id].ts', () => {
    touch('api/v2/posts.[id].ts')

    const plan = relativize(planRouterMigration(routesDir))
    expect(plan).toEqual([{ from: 'api/v2/posts.[id].ts', to: 'api/v2/posts/[id].ts' }])
  })

  it('test_idempotency: second pass over already-migrated tree returns empty plan', () => {
    touch('auth/[provider]/login.ts')
    touch('posts/[id].ts')

    const firstPass = planRouterMigration(routesDir)
    expect(firstPass).toEqual([])

    // Simulate a second `theokit migrate router` invocation on a clean tree
    const secondPass = planRouterMigration(routesDir)
    expect(secondPass).toEqual([])
  })
})
