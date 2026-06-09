/**
 * G6 T0.1 — Dotted-path regression test (INVERTED after T1.1).
 *
 * Plan: .claude/knowledge-base/plans/g6-router-convention-plan.md v1.1
 *
 * History:
 *   - Phase 0 (RED, 2026-06-04 madrugada): asserted the BROKEN behavior of the
 *     scanner — `auth.[provider].login.ts` succeeded but produced
 *     `paramNames: ['provider.login']` (single param with literal dot) and
 *     `routePath: '/api/auth.:provider.login'` (literal dot in URL pattern).
 *   - Phase 1 T1.1 (GREEN, 2026-06-04 madrugada): scanner now REJECTS dotted
 *     basenames with `RouterConventionError`. This file asserts the new
 *     contract; the original BROKEN assertions are preserved in commit
 *     history (`git log --follow tests/unit/server-route-scan-dotted-regression.test.ts`).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { scanServerRoutes } from '../../packages/theo/src/server/scan/scan.js'
import { RouterConventionError } from '../../packages/theo/src/server/scan/errors.js'
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

describe('G6 T0.1 — dotted-path regression (post-T1.1 rejection contract)', () => {
  it('test_dotted_middle_param_now_rejected: auth.[provider].login.ts throws RouterConventionError', () => {
    touch('auth.[provider].login.ts')
    // BEFORE T1.1: silently produced paramNames=['provider.login'] (bug).
    // AFTER T1.1: fails fast at scan time with actionable error.
    expect(() => scanServerRoutes(serverDir)).toThrow(RouterConventionError)
  })

  it('test_dotted_trailing_only_now_rejected: posts.[id].ts throws RouterConventionError', () => {
    touch('posts.[id].ts')
    // BEFORE T1.1: silently produced routePath='/api/posts.:id' (literal dot,
    // unreachable from request `/api/posts/42`).
    // AFTER T1.1: fails fast at scan time with actionable error.
    expect(() => scanServerRoutes(serverDir)).toThrow(RouterConventionError)
  })
})
