/**
 * A build-time scanner must not run at import time, because a Worker imports it.
 *
 * `detect-agent-policy.ts` called `createRequire(import.meta.url)` and `require_('typescript')` at
 * MODULE SCOPE. In Node that is invisible. On Cloudflare Workers it is fatal twice over:
 * `import.meta.url` is undefined there, and the module loads the TypeScript COMPILER into a worker
 * that will never parse a source file.
 *
 * Found by deploying, 2026-09-26 (B-263). Cloudflare EXECUTES the module during validation, so the
 * upload succeeded — 307 assets, 12,695 KiB — and then:
 *
 *     ✘ Uncaught TypeError: The argument 'path' must be a file URL object, a file URL string, or
 *       an absolute path string.. Received 'undefined'
 *         at createRequire (node:module:34:15)
 *         at detect-agent-policy.ts:33:18                             [code: 10021]
 *
 * ## Why no earlier gate saw it
 *
 * `wrangler deploy --dry-run` BUNDLES and does not execute — it had just returned exit 0 with zero
 * errors on this same worker. The vitest suite runs under Node, where `import.meta.url` is a real
 * file URL. The chain is `theokit/server/scan` -> `agent-scan.ts:10` -> here, so nothing about the
 * import looks like it reaches a compiler.
 *
 * ## What is asserted
 *
 * The property that failed, at the only place it can be checked without a Worker: the module's own
 * source. `createRequire` may be IMPORTED at top level — that is inert — but calling it, and
 * requiring `typescript`, must happen inside the function that needs them.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { declaresAgentPolicy } from '../../packages/theo/src/server/scan/detect-agent-policy.js'

const SCAN_DIR = join(import.meta.dirname, '../../packages/theo/src/server/scan')

const SOURCE = readFileSync(join(SCAN_DIR, 'detect-agent-policy.ts'), 'utf8')

/**
 * Every scanner in the directory, because this is a CLASS of defect rather than one file.
 *
 * Fixing `detect-agent-policy.ts` moved the deploy failure to `detect-http-methods.ts:26` and would
 * have moved it again to `detect-route-policy.ts:45`. Each deploy costs minutes, so the assertion
 * sweeps the directory and a fourth file added later is caught before anybody reaches for wrangler.
 */
const SCANNERS = readdirSync(SCAN_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => [f, readFileSync(join(SCAN_DIR, f), 'utf8')] as const)

/**
 * Everything before the first `function` declaration, with comments removed — the code that runs on
 * import.
 *
 * Stripping comments is not tidiness. The first version of this test reported
 * `detect-http-methods.ts` as an offender because its docblock said, in prose, "We use
 * `createRequire(import.meta.url)` to keep the package on its native CJS path". The call had already
 * moved into a function; the SENTENCE about it had not. CLAUDE.md § 3.1 names exactly this — grep the
 * declaration, never the word.
 */
function moduleScope(source: string): string {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const firstDecl = withoutComments.search(/^(?:export )?(?:async )?function /m)
  return firstDecl === -1 ? withoutComments : withoutComments.slice(0, firstDecl)
}

describe('the agent-policy scanner loads TypeScript lazily', () => {
  it('test_no_scanner_CALLS_createRequire_at_module_scope', () => {
    // Importing it is fine; invoking it with `import.meta.url` is what threw on Workers.
    const offenders = SCANNERS.filter(([, src]) => moduleScope(src).includes('createRequire(')).map(
      ([name]) => name,
    )

    expect(
      offenders,
      'createRequire(import.meta.url) at module scope throws on Cloudflare Workers, where ' +
        'import.meta.url is undefined — and these files are reachable from the generated worker ' +
        'through theokit/server/scan',
    ).toEqual([])
  })

  it('test_no_scanner_requires_typescript_at_module_scope', () => {
    // Independent of Workers: nothing that merely IMPORTS a scanner should pay for the compiler.
    const offenders = SCANNERS.filter(([, src]) =>
      /require_?\(\s*['"]typescript['"]\s*\)/.test(moduleScope(src)),
    ).map(([name]) => name)

    expect(offenders).toEqual([])
  })

  it('test_the_sweep_actually_reads_the_scanners', () => {
    // COUNTERPROOF for the two above: an empty list passes them trivially. Measured when written:
    // three files in this directory called createRequire at module scope.
    expect(SCANNERS.length).toBeGreaterThanOrEqual(3)
    expect(SCANNERS.map(([n]) => n)).toContain('detect-agent-policy.ts')
  })

  it('test_the_scanner_still_works', () => {
    // COUNTERPROOF: the two assertions above are satisfied by deleting the compiler entirely, which
    // would leave the scanner unable to answer anything. This is the behaviour they must not cost.
    expect(declaresAgentPolicy('a.ts', `export const policy = 'public'`)).toBe(true)
    expect(declaresAgentPolicy('a.ts', `export function policy() { return true }`)).toBe(true)
    expect(declaresAgentPolicy('a.ts', `export { policy } from './shared.js'`)).toBe(true)
    expect(declaresAgentPolicy('a.ts', `export const handler = 1`)).toBe(false)
  })

  it('test_it_is_loaded_once_and_reused', () => {
    // A lazy loader that re-requires on every call would turn a build-time cost into a per-file one.
    // Two calls, and the second must not pay for a second require — asserted through behaviour
    // rather than by counting, since the cache is module-private.
    const first = declaresAgentPolicy('a.ts', `export const policy = 'public'`)
    const second = declaresAgentPolicy('b.ts', `export const policy = 'public'`)
    expect([first, second]).toEqual([true, true])
    expect(SOURCE).toMatch(/let\s+\w+:\s*typeof TS\s*\|\s*undefined|\w+\s*\?\?=/)
  })
})
