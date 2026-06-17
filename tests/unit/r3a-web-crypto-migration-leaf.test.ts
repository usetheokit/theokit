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
  //        manifest-write leaf (`.theokit/jobs.json` etc). Per ADR-0028 the
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

  // ===== T5a.1d additions (slice 4/N — LAST node:crypto removal in server/) =====
  // Last node:crypto consumer in server/: rate-limit/rate-limit-per-route.ts.
  // `createHash` is sync but Web Crypto subtle.digest is async. The factory
  // exports deriveKey + createRouteRateLimiter, both sync. The cascade:
  //   hashFragment(input): string → Promise<string>
  //   deriveKey(req, keyBy, cookie): string → Promise<string>
  //   checkRouteRateLimit(req): RateLimitResult → Promise<RateLimitResult>
  // No production caller of createRouteRateLimiter exists (verified via grep;
  // api-middleware uses the sibling createRateLimiter from rate-limit.ts).
  // Only the 9 test sites need updating.

  it('rate-limit-per-route.ts no longer imports from node:crypto', () => {
    const source = readSource('packages/theo/src/server/rate-limit/rate-limit-per-route.ts')
    expect(source).not.toMatch(/from\s+['"]node:crypto['"]/)
  })

  it('rate-limit-per-route.ts uses Web Crypto subtle.digest for hashing', () => {
    const source = readSource('packages/theo/src/server/rate-limit/rate-limit-per-route.ts')
    expect(source).toMatch(/(globalThis\.)?crypto\.subtle\.digest/)
  })

  it('audit: node:crypto consumer count in server/ has dropped to 0 after T5a.1a+T5a.1b+T5a.1c+T5a.1d', () => {
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
    expect(count).toBe(0) // post-T5a.1d — full Web Crypto cutover in server/
  })

  // ===== Phase 5a invariant guard (R3a Web standards runtime portability) =====
  // Documented in docs/audit/arch-gaps-phase5a-progress-2026-06-06.md.
  // The 24 current node:http consumers in server/ are ALL `import type` —
  // TypeScript erases them at build, so the emitted JS is runtime-clean.
  // This guard fires if a future change introduces a RUNTIME (non-type) node:http
  // import that would break CF Workers / Bun / Deno bundling.

  /**
   * Line-based, ReDoS-safe detector for runtime (non-type) imports from a
   * given node:* module. Walks lines, matches the literal `'node:<name>'`,
   * and skips any line whose trimmed prefix starts with `import type` (the
   * TS-erased form is OK; only runtime imports are flagged).
   */
  function hasRuntimeNodeImport(src: string, moduleName: string): boolean {
    const needle = `'node:${moduleName}'`
    const altNeedle = `"node:${moduleName}"`
    for (const line of src.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('import')) continue
      if (trimmed.startsWith('import type ')) continue
      if (trimmed.includes(needle) || trimmed.includes(altNeedle)) return true
    }
    return false
  }

  it('invariant: zero runtime (non-type) node:http imports in server/ (R3a runtime portability)', () => {
    const serverDir = resolve(REPO_ROOT, 'packages/theo/src/server')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
        } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
          const src = readFileSync(full, 'utf8')
          if (hasRuntimeNodeImport(src, 'http')) {
            offenders.push(full.replace(REPO_ROOT + '/', ''))
          }
        }
      }
    }
    walk(serverDir)
    expect(offenders).toEqual([])
  })

  it('invariant: zero runtime node:* imports in server/ outside the documented Node-only leaves (audit doc)', () => {
    // Per docs/audit/arch-gaps-phase5a-progress-2026-06-06.md Category B,
    // these files are legitimately Node-only at scanner/build/static-file
    // boundary per ADR-0028. Allowlisted explicitly. Any new file appearing
    // with a runtime node:* import OUTSIDE this allowlist is a regression.
    const NODE_ONLY_ALLOWLIST = new Set<string>([
      // Build-time scanners
      'packages/theo/src/server/scan/scan.ts',
      'packages/theo/src/server/scan/manifest.ts',
      'packages/theo/src/server/scan/action-scan.ts',
      'packages/theo/src/server/scan/middleware-scan.ts',
      'packages/theo/src/server/scan/ws-scan.ts',
      'packages/theo/src/server/scan/detect-http-methods.ts',
      'packages/theo/src/server/scan/module-loader.ts',
      'packages/theo/src/server/jobs/job-scan.ts',
      'packages/theo/src/server/cron/cron-scan.ts',
      // Build-time manifest writers / cron emit
      'packages/theo/src/server/_internal/atomic-write.ts',
      'packages/theo/src/server/_internal/scan-walker.ts',
      'packages/theo/src/server/cron/adapter-translators.ts',
      // Boot-time wiring (once per process)
      'packages/theo/src/server/http/middleware-runner.ts',
      'packages/theo/src/server/http/error-pages.ts',
      // Node-adapter scope per ADR-0028 (static-file serving = Node only)
      'packages/theo/src/server/http/static.ts',
      // Node-adapter scope: Busboy multipart parser (Node-only); the Web
      // Standards alternative ships at packages/theo/src/server/body-parser-web.ts
      // (zero node:* imports — uses request.formData()).
      'packages/theo/src/server/body-parser.ts',
      // Node-adapter scope (T5a.2 Phase G slice 5/N): IncomingMessage ↔
      // Web Request bridge. Per ADR-0028 R3a, the Node adapter is the
      // ONLY place IncomingMessage ↔ Request conversion happens; this
      // file legitimately imports node:http + node:stream to drain the
      // body. Web Workers / CF Workers / Bun / Deno do not load this
      // module — they pass native Web Request through executeWebRequest
      // directly without the bridge.
      'packages/theo/src/server/http/node-web-adapter.ts',
      // Static-file boundary: the built-in OpenAPI docs server reads the
      // emitted spec file from disk (node:fs) and resolves its path
      // (node:path). Like static.ts, this is Node-adapter scope per
      // ADR-0028 — CF Workers / Bun / Deno serve the spec from their own
      // asset layer, not this module.
      'packages/theo/src/server/openapi/serve-docs.ts',
    ])

    /**
     * Line-based, ReDoS-safe detector for ANY runtime node:* import.
     * Matches `'node:<...>'` or `"node:<...>"` on lines starting with
     * `import` but NOT `import type `.
     */
    function hasAnyRuntimeNodeImport(src: string): boolean {
      for (const line of src.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('import')) continue
        if (trimmed.startsWith('import type ')) continue
        if (trimmed.includes("'node:") || trimmed.includes('"node:')) return true
      }
      return false
    }

    const serverDir = resolve(REPO_ROOT, 'packages/theo/src/server')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
        } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
          const src = readFileSync(full, 'utf8')
          const rel = full.replace(REPO_ROOT + '/', '')
          if (hasAnyRuntimeNodeImport(src) && !NODE_ONLY_ALLOWLIST.has(rel)) {
            offenders.push(rel)
          }
        }
      }
    }
    walk(serverDir)
    expect(offenders).toEqual([])
  })
})
