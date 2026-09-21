/**
 * Every value symbol published on `theokit/server/rate-limit` carries a recorded decision.
 *
 * `server/rate-limit/index.ts` is four `export *` lines and `package.json` declares the subpath,
 * so a symbol reaches consumers by accident of syntax rather than by decision. Measured
 * 2026-09-20: nine value symbols are published and only two have a durable consumer outside the
 * directory. Nothing distinguished a promise from a helper that happened to carry `export`.
 *
 * This reads the BUILT module on purpose, copying its sibling
 * `umbrella-symbols-have-a-subpath.test.ts`: `exports` maps to `dist/`, so the built namespace is
 * what a consumer can import. A source-level check would answer a different question — and did,
 * when B-203 was registered with "18 symbols", a count that included nine types no consumer can
 * import at runtime.
 *
 * The comparison runs in BOTH directions. One way lets the record describe symbols that no longer
 * exist, which is how a hand-maintained list rots; the sibling's docblock warns that "a list would
 * have to be updated by the same person who broke it".
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, it, expect, beforeAll } from 'vitest'

import {
  BUILD_HOOK_TIMEOUT_MS,
  buildTheokitPackageOnce,
} from '../integration/_helpers/build-theokit-package.js'

const packageRoot = resolve(__dirname, '../../packages/theo')
const builtModule = resolve(packageRoot, 'dist/server/rate-limit/index.js')
const recordPath = resolve(__dirname, '../../docs/api/rate-limit-subpath-surface.md')

/** Names in the built namespace, which carries VALUES only — types are erased at build. */
let builtSymbols: string[] = []

/** One row per decided symbol: `| name | verdict | reason |`. */
let decided: { name: string; verdict: string; reason: string }[] = []

const ROW = /^\|\s*`?([A-Za-z_$][\w$]*)`?\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/u

beforeAll(async () => {
  buildTheokitPackageOnce()

  expect(
    existsSync(builtModule),
    `${builtModule} is absent after a build that reported success. An absent module must not read ` +
      'as zero symbols — that would make every row of the record look stale at once.',
  ).toBe(true)

  const namespace: Record<string, unknown> = await import(builtModule)
  builtSymbols = Object.keys(namespace)
    .filter((n) => n !== 'default')
    .sort((a, b) => a.localeCompare(b))

  expect(
    existsSync(recordPath),
    `${recordPath} is absent. Every published symbol is undecided until that file says otherwise: ` +
      builtSymbols.join(', '),
  ).toBe(true)

  decided = readFileSync(recordPath, 'utf8')
    .split('\n')
    .map((line) => ROW.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .filter((m) => m[1] !== 'Symbol')
    .map((m) => ({ name: m[1], verdict: m[2], reason: m[3] }))
}, BUILD_HOOK_TIMEOUT_MS)

describe('the rate-limit subpath publishes nothing undecided', () => {
  it('test_the_record_parses_to_more_than_zero_rows', () => {
    // EC-2. A renamed heading or a pipe lost to a reflow parses to an empty set, which would make
    // every built symbol look undecided and send the author to re-add rows that were never lost.
    expect(
      decided.length,
      `${recordPath} parsed to zero rows. The table's shape changed; this is not nine undecided ` +
        'symbols.',
    ).toBeGreaterThan(0)
  })

  it('test_the_default_export_is_not_counted_as_a_symbol', () => {
    // EC-3. The sibling gate filters `default` explicitly, which is evidence the case is real in
    // this build rather than invented.
    expect(builtSymbols).not.toContain('default')
  })

  it('test_every_built_symbol_carries_a_decision', () => {
    const decidedNames = new Set(decided.map((d) => d.name))
    const undecided = builtSymbols.filter((s) => !decidedNames.has(s))
    expect(
      undecided,
      `built and not decided: ${undecided.join(', ')}. Either record the symbol in ${recordPath} ` +
        'with a verdict and a reason, or stop exporting it through this subpath.',
    ).toEqual([])
  })

  it('test_every_decided_symbol_is_still_built', () => {
    // The other direction, and the one a hand-maintained list always loses.
    const stale = decided.map((d) => d.name).filter((n) => !builtSymbols.includes(n))
    expect(
      stale,
      `decided and not built: ${stale.join(', ')}. The record outlived the symbol; delete the row.`,
    ).toEqual([])
  })

  it('test_a_symbol_with_no_consumer_carries_a_reason_of_fifteen_words', () => {
    // AC-005. Seven rows need a written reason: six with no consumer at all, and
    // `createRateLimiterWeb`, whose only consumer travels a path scheduled for deletion.
    const needsReason = decided.filter((d) => !/^no decision needed$/iu.test(d.verdict.trim()))
    const tooShort = needsReason.filter((d) => d.reason.trim().split(/\s+/u).length < 15)
    expect(
      tooShort.map((d) => d.name),
      'a one-word verdict is the drift this gate exists to stop; these rows need a reason of at ' +
        'least fifteen words',
    ).toEqual([])
  })
})
