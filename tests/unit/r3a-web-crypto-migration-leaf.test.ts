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

  // ===== T5a.1b additions (slice 2/N) =====
  // Two more pure-leaf node:crypto swaps:
  //   3. packages/theo/src/server/_internal/atomic-write.ts
  //      - was: `import { randomBytes } from 'node:crypto'`
  //      - now: `globalThis.crypto.getRandomValues(new Uint8Array(N))`
  //      - NOTE: keeps `node:fs` + `node:path` because this is a build-time
  //        manifest-write leaf (`.theo/jobs.json` etc). Per ADR-0028 the
  //        runtime-portable boundary is the request handler, not the scanner.
  //   4. packages/theo/src/server/http/trace-context.ts
  //      - was: `import { randomUUID } from 'node:crypto'`
  //      - now: `globalThis.crypto.randomUUID()`
  //      - NOTE: keeps `import type { IncomingMessage } from 'node:http'`
  //        (type-only import, runtime-clean). Full IncomingMessage→Request
  //        boundary migration deferred to a later T5a.1c+ slice.

  it('atomic-write.ts no longer imports from node:crypto', () => {
    const source = readSource('packages/theo/src/server/_internal/atomic-write.ts')
    expect(source).not.toMatch(/from\s+['"]node:crypto['"]/)
  })

  it('atomic-write.ts uses Web Crypto API (crypto.getRandomValues)', () => {
    const source = readSource('packages/theo/src/server/_internal/atomic-write.ts')
    expect(source).toMatch(/(globalThis\.)?crypto\.getRandomValues\(/)
  })

  it('http/trace-context.ts no longer imports randomUUID from node:crypto', () => {
    const source = readSource('packages/theo/src/server/http/trace-context.ts')
    expect(source).not.toMatch(/from\s+['"]node:crypto['"]/)
  })

  it('http/trace-context.ts uses Web Crypto API (crypto.randomUUID)', () => {
    const source = readSource('packages/theo/src/server/http/trace-context.ts')
    expect(source).toMatch(/(globalThis\.)?crypto\.randomUUID\(\)/)
  })

  // ===== T5a.1c additions (slice 3/N) =====
  // 3 webhook signature providers (HMAC-SHA256 hex computation). Each is
  // already `async (req: Request)` so swapping sync `createHmac` for the
  // async `crypto.subtle.sign('HMAC', ...)` is zero public API change.
  //   5. packages/theo/src/server/webhook/providers/github.ts
  //   6. packages/theo/src/server/webhook/providers/slack.ts
  //   7. packages/theo/src/server/webhook/providers/stripe.ts

  it('webhook/providers/github.ts no longer imports from node:crypto', () => {
    const source = readSource('packages/theo/src/server/webhook/providers/github.ts')
    expect(source).not.toMatch(/from\s+['"]node:crypto['"]/)
  })

  it('webhook/providers/github.ts uses Web Crypto subtle.sign for HMAC', () => {
    const source = readSource('packages/theo/src/server/webhook/providers/github.ts')
    expect(source).toMatch(/(globalThis\.)?crypto\.subtle\.(sign|importKey)/)
  })

  it('webhook/providers/slack.ts no longer imports from node:crypto', () => {
    const source = readSource('packages/theo/src/server/webhook/providers/slack.ts')
    expect(source).not.toMatch(/from\s+['"]node:crypto['"]/)
  })

  it('webhook/providers/slack.ts uses Web Crypto subtle.sign for HMAC', () => {
    const source = readSource('packages/theo/src/server/webhook/providers/slack.ts')
    expect(source).toMatch(/(globalThis\.)?crypto\.subtle\.(sign|importKey)/)
  })

  it('webhook/providers/stripe.ts no longer imports from node:crypto', () => {
    const source = readSource('packages/theo/src/server/webhook/providers/stripe.ts')
    expect(source).not.toMatch(/from\s+['"]node:crypto['"]/)
  })

  it('webhook/providers/stripe.ts uses Web Crypto subtle.sign for HMAC', () => {
    const source = readSource('packages/theo/src/server/webhook/providers/stripe.ts')
    expect(source).toMatch(/(globalThis\.)?crypto\.subtle\.(sign|importKey)/)
  })

  it('audit: node:crypto consumer count in server/ has dropped to ≤ 1 after T5a.1a+T5a.1b+T5a.1c', () => {
    // Baseline cascade:
    //   pre-T5a.1a = 8
    //   T5a.1a removes 2 → 6 (job-backend-memory, trace-context-propagation)
    //   T5a.1b removes 2 → 4 (atomic-write, http/trace-context)
    //   T5a.1c removes 3 → 1 (webhook/providers/{slack,github,stripe})
    // Remaining: rate-limit/rate-limit-per-route.ts (sync createHash —
    // async migration would cascade through keyForRequest → routeRateLimit
    // middleware; deferred to T5a.1d+ when boundary refactor is sized).
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
    expect(count).toBeLessThanOrEqual(1) // post-T5a.1c
  })
})
