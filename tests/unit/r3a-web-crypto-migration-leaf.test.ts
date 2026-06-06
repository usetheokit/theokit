/**
 * RED test for Plan T5a.1a — incremental Web Crypto migration (leaf-first).
 *
 * Per `docs/plans/theokit-arch-gaps-implementation-plan.md` v1.2 Phase 5a T5a.1
 * Task #3: "Refactor em ordem de dependência (leaves primeiro)".
 *
 * The full T5a.1 scope (42 files across `server/` migrating from node:* to
 * Web Standards) is too large for a single iteration AND has a documented
 * pause condition (wrangler CF account credentials required for end-to-end
 * smoke). This RED test scopes Iteration A to the smallest safe slice:
 * the two PURE-LEAF files that only need a `node:crypto` import swap +
 * direct Web Crypto API substitution, with no public API surface change.
 *
 * Leaf files migrated in this slice:
 *   1. packages/theo/src/server/jobs/job-backend-memory.ts
 *      - was: `import { randomUUID } from 'node:crypto'`
 *      - now: `globalThis.crypto.randomUUID()` (Web Crypto global; available
 *        in Node 22+, CF Workers, Bun, Deno, browsers).
 *   2. packages/theo/src/server/observability/trace-context-propagation.ts
 *      - was: `import { randomBytes } from 'node:crypto'`
 *      - now: `globalThis.crypto.getRandomValues(new Uint8Array(N))` (Web Crypto).
 *
 * RED assertion: neither file imports anything from 'node:crypto' anymore.
 * Behavior preservation is covered by EXISTING tests
 * (`tests/unit/job-backend-memory.test.ts`,
 * `tests/unit/trace-context-propagation.test.ts`) — those must continue to
 * pass post-migration. This file does NOT re-test what they already test.
 *
 * NOTE: this is INCREMENTAL progress on T5a.1. The remaining ~40 files
 * (csrf.ts, execute.ts, body-parser.ts, fs/path consumers, etc.) require
 * dedicated future iterations (T5a.1b through T5a.1N).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(__dirname, '..', '..')

function readSource(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

describe('T5a.1a — leaf-file Web Crypto migration (node:crypto → globalThis.crypto)', () => {
  it('job-backend-memory.ts no longer imports from node:crypto', () => {
    // Given: the leaf file targeted by T5a.1a
    const source = readSource('packages/theo/src/server/jobs/job-backend-memory.ts')

    // Then: no node:crypto import remains
    expect(source).not.toMatch(/from\s+['"]node:crypto['"]/)
  })

  it('job-backend-memory.ts uses Web Crypto API (globalThis.crypto.randomUUID or crypto.randomUUID)', () => {
    // Given: the leaf file targeted by T5a.1a
    const source = readSource('packages/theo/src/server/jobs/job-backend-memory.ts')

    // Then: the Web Crypto substitution is in place
    // (accepts either `globalThis.crypto.randomUUID()` or bare `crypto.randomUUID()`
    // since Web Crypto is on globalThis in every supported runtime per ADR-0028)
    expect(source).toMatch(/(globalThis\.)?crypto\.randomUUID\(\)/)
  })

  it('trace-context-propagation.ts no longer imports from node:crypto', () => {
    // Given: the leaf file targeted by T5a.1a
    const source = readSource('packages/theo/src/server/observability/trace-context-propagation.ts')

    // Then: no node:crypto import remains
    expect(source).not.toMatch(/from\s+['"]node:crypto['"]/)
  })

  it('trace-context-propagation.ts uses Web Crypto API (crypto.getRandomValues)', () => {
    // Given: the leaf file targeted by T5a.1a
    const source = readSource('packages/theo/src/server/observability/trace-context-propagation.ts')

    // Then: the Web Crypto substitution is in place
    expect(source).toMatch(/(globalThis\.)?crypto\.getRandomValues\(/)
  })

  it('audit: node:crypto consumer count in server/ has decreased by 2 from pre-T5a.1a baseline', () => {
    // Given: the pre-T5a.1a baseline was 8 files importing node:crypto (audited
    // 2026-06-06 before this iteration started). The slice migrates 2 of them.
    // Then: post-migration the count is ≤ 6.
    // Future iterations T5a.1b+ will continue decrementing this number.
    //
    // We measure by grepping the live tree — the assertion uses Node's fs to
    // walk the server/ directory and count occurrences. This is a process-level
    // audit, NOT a unit-level grep, so it catches regressions in any file.
    const serverDir = resolve(REPO_ROOT, 'packages/theo/src/server')
    let count = 0
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
        } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
          const src = readFileSync(full, 'utf8')
          if (/from\s+['"]node:crypto['"]/.test(src)) count += 1
        }
      }
    }
    walk(serverDir)
    expect(count).toBeLessThanOrEqual(6) // pre-T5a.1a = 8; T5a.1a removes 2
  })
})
