/**
 * R3a runtime-portability invariant — emitted-bundle empirical proof.
 *
 * Per `docs/audit/arch-gaps-phase5a-progress-2026-06-06.md` Category A:
 * the 24 type-only `import type ... from 'node:http'` declarations in
 * `packages/theo/src/server/` are TS-erased at build time. The emitted
 * JavaScript should contain ZERO `node:http` runtime references — that is
 * the SEMANTIC R3a runtime-portability claim.
 *
 * This test is the empirical proof: it reads compiled `dist/server/*.js`
 * files and asserts no runtime `node:http` reference survives the build.
 * Stronger than source-level grep (the existing
 * `r3a-web-crypto-migration-leaf.test.ts` invariant guard) because it
 * verifies the actual emitted bundle behavior — not the source code.
 *
 * **Scope:** `dist/server/` only. Other dist subtrees (`dist/cli/*`,
 * `dist/adapters/*`) legitimately ship Node-only code per ADR-0028 (CLI
 * + scanner + adapter boundary). This test guards the request-handler
 * surface that runs on CF Workers / Bun / Deno.
 *
 * **Allowlist (Category B per Phase 5a audit):** files that legitimately
 * ship Node-only runtime code because they are scanner/build/static/
 * adapter-scope per ADR-0028. The allowlist is identical to the source-
 * level invariant guard in `r3a-web-crypto-migration-leaf.test.ts`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it, beforeAll } from 'vitest'

import { buildTheokitPackageOnce } from '../integration/_helpers/build-theokit-package.js'

const ROOT = process.cwd()
const DIST_SERVER = resolve(ROOT, 'packages/theo/dist/server')

/**
 * Node-only runtime allowlist (mirrors source-level Category B). These
 * dist files correspond to source files where `import { X } from 'node:*'`
 * is legitimate per ADR-0028. The dist filename pattern is the source
 * basename (tsup preserves it through the build chain).
 */
const DIST_NODE_ONLY_ALLOWLIST = new Set<string>([
  // scanners + build-time leaves
  'scan.js',
  'manifest.js',
  'action-scan.js',
  'middleware-scan.js',
  'ws-scan.js',
  'detect-http-methods.js',
  'module-loader.js',
  'job-scan.js',
  'cron-scan.js',
  'atomic-write.js',
  'scan-walker.js',
  // boot-time wiring
  'middleware-runner.js',
  'error-pages.js',
  // Node-adapter scope
  'static.js',
  'body-parser.js',
  // cron adapter translators (boot-time emit)
  'adapter-translators.js',
])

describe('R3a emitted-bundle runtime-portability (Phase 5a audit Category A proof)', () => {
  beforeAll(() => {
    buildTheokitPackageOnce()
  })

  it('dist/server/ exists after tsup build', () => {
    expect(existsSync(DIST_SERVER)).toBe(true)
  })

  it('emitted dist/server/*.js contains zero runtime `node:http` references outside the allowlist', () => {
    // Given: a fresh tsup build of theokit
    // When: we walk dist/server/ and grep for the literal 'node:http' string
    // Then: only Category B allowlisted files (Node-only scanner/build/
    // adapter scope per ADR-0028) may contain it; the request-handler
    // surface MUST be clean.
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        // Skip non-JS + source-map files (which contain stringified
        // source-side content and would trip the grep with type-only imports).
        if (!full.endsWith('.js')) continue
        const src = readFileSync(full, 'utf8')
        if (!src.includes('node:http')) continue
        // Found a match — check if file is allowlisted.
        const basename = entry.replace(/-[A-Z0-9]{6,}\.js$/, '.js') // tsup hashes
        if (!DIST_NODE_ONLY_ALLOWLIST.has(basename)) {
          offenders.push(full.replace(ROOT + '/', ''))
        }
      }
    }
    walk(DIST_SERVER)
    expect(offenders).toEqual([])
  })

  it('the request-handler entry-point dist/server/index.js is fully node:http-free', () => {
    // Given: the canonical Web-Standards entry point (executeWebRequest +
    // re-exports per T5a.2 Phase A)
    // Then: the emitted index.js contains zero `node:http` references
    // (the type-only imports in source MUST be TS-erased).
    const indexJs = resolve(DIST_SERVER, 'index.js')
    expect(existsSync(indexJs)).toBe(true)
    const src = readFileSync(indexJs, 'utf8')
    expect(src).not.toContain('node:http')
  })

  it('emitted dist/server/web-handler*.js (executeWebRequest) is fully node:http-free', () => {
    // Given: the Phase A Web-Standards entry-point file in dist/
    // Then: its emitted JS contains zero node:* runtime references
    // (the source has no node:* imports at all — type or runtime).
    // tsup may rename to dist/server/web-handler-<hash>.js (hashed) or
    // dist/server/web-handler.js (un-hashed). Walk dist/server/ to find it.
    let webHandlerJs: string | null = null
    for (const entry of readdirSync(DIST_SERVER)) {
      // ReDoS-safe: anchored prefix + bounded basename + bounded hash + literal .js
      if (
        entry.startsWith('web-handler') &&
        entry.endsWith('.js') &&
        (entry === 'web-handler.js' || /^web-handler-[A-Z0-9]{6,16}\.js$/.test(entry))
      ) {
        webHandlerJs = resolve(DIST_SERVER, entry)
        break
      }
    }
    // If web-handler is inlined into index.js by tsup (no separate chunk),
    // this test passes via the "request-handler entry-point" assertion above.
    if (webHandlerJs === null) {
      // Verify the function IS reachable via index.js as proxy
      const indexJs = resolve(DIST_SERVER, 'index.js')
      const src = readFileSync(indexJs, 'utf8')
      // executeWebRequest is the function name; verify export presence
      expect(src).toContain('executeWebRequest')
      return
    }
    const src = readFileSync(webHandlerJs, 'utf8')
    expect(src).not.toContain('node:http')
    expect(src).not.toContain('node:crypto')
    expect(src).not.toContain('node:fs')
    expect(src).not.toContain('node:path')
    expect(src).not.toContain('node:url')
    expect(src).not.toContain('node:module')
  })

  it('audit: count of dist/server/*.js files containing node:http is at most equal to allowlist size', () => {
    // Sanity check — if the allowlist grows out of sync with dist reality,
    // this test surfaces the drift. Bound is generous (≤ allowlist size).
    let count = 0
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!full.endsWith('.js')) continue
        const src = readFileSync(full, 'utf8')
        if (src.includes('node:http')) count += 1
      }
    }
    walk(DIST_SERVER)
    expect(count).toBeLessThanOrEqual(DIST_NODE_ONLY_ALLOWLIST.size)
  })
})
