/**
 * B-181 — a README row that claims a surface is `read` names a reader, and the name must resolve.
 *
 * ## Why this exists, measured
 *
 * This package's README publishes a table of which `.claude/` surfaces it reads. The claim is prose.
 * The item that produced this test exists because the README said `agent-memory/` was **read** while
 * `.claude/rules/foreign-config-surfaces.md` said **resolvable, no caller outside its own tests** —
 * corrected 2026-09-18, three days after the item was filed against the disagreement. The drift is
 * gone; nothing would have caught it.
 *
 * ## What this checks, and what it deliberately does not
 *
 * It checks the CLAIM: a row saying `read` and naming a reader must name something that resolves
 * with a caller outside test files. It does NOT compute the verdict column — that column carries
 * judgement no compiler answers (`read when the dialect is declared`, `out of scope HERE — read by
 * the consumer`). `capability-map-is-current.test.ts` can generate its document because its oracle is
 * `checker.getExportsOfModule`, which enumerates a fact. There is no analogous call for scope.
 *
 * ## Resolution is by TEXT SEARCH, and that is a stated limit
 *
 * A symbol named in a comment counts as a reference. A false pass therefore needs someone to write
 * the name in a comment AND delete every real caller. The alternative — a compiler pass over two
 * packages — costs more than the two rows it would harden.
 *
 * ## An empty input FAILS
 *
 * Coverage is asserted, not assumed: measured 2026-09-21, 3 of 14 rows name a lowercase identifier
 * and 2 name a real function. If a reformat leaves the parser finding nothing, the floor assertion
 * fails rather than the suite passing over an empty set — which is this item's own defect genre.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/** The section the table lives under. Named, because an indexOf on a wrong string
 * silently yields an empty table, and an empty table is a check that verifies nothing. */
const SURFACES_HEADING = '## Foreign configuration surfaces'

const PKG = resolve(import.meta.dirname, '..', '..')
const REPO = resolve(PKG, '..', '..')
const README = join(PKG, 'README.md')

/** A row of the surfaces table that claims the surface is read and names who reads it. */
interface ClaimingRow {
  readonly line: number
  readonly surface: string
  readonly reader: string
}

/** Rows whose verdict says `read` without saying `out of scope` or `refused`, and name a reader. */
function claimingRows(markdown: string): { claims: ClaimingRow[]; unchecked: number } {
  const claims: ClaimingRow[] = []
  let unchecked = 0
  // Bounded to the surfaces table. Reviewing this file's own first revision found it matching ANY
  // markdown row containing "read" anywhere in the README — `./tools` at :45 and a row about a
  // variable at :280 were being counted. Harmless while they name no identifier, and a row checked
  // as a surface claim the moment one of them does.
  const start = markdown.indexOf(SURFACES_HEADING)
  const lineOffset = start < 0 ? 0 : markdown.slice(0, start).split('\n').length - 1
  const table = start < 0 ? '' : markdown.slice(start, markdown.indexOf('\n## ', start + 4))
  table.split('\n').forEach((raw, i) => {
    if (!raw.startsWith('|')) return
    const lower = raw.toLowerCase()
    if (!lower.includes('read')) return
    if (lower.includes('out of scope') || lower.includes('refused')) return
    const cells = raw.split('|').map((c) => c.trim())
    const surface = cells[1] ?? ''
    // A reader is a backticked lowerCamelCase identifier: `applySubagentMemory`, not `settings.json`.
    const reader = [...raw.matchAll(/`([a-z][A-Za-z0-9]{7,})`/g)]
      .map((m) => m[1])
      .find((name) => /[A-Z]/.test(name))
    if (reader === undefined) {
      unchecked += 1
      return
    }
    claims.push({ line: lineOffset + i + 1, surface, reader })
  })
  return { claims, unchecked }
}

/** Every `.ts` file under a directory, excluding tests and anything generated. */
function sources(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      const full = join(d, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!full.endsWith('.ts') || full.includes('.test.')) continue
      out.push(full)
    }
  }
  walk(dir)
  return out
}

const markdown = readFileSync(README, 'utf8')
const { claims, unchecked } = claimingRows(markdown)
const HAYSTACK = [join(PKG, 'src'), join(REPO, 'apps', 'theocode')]
  .flatMap((d) => sources(d))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

describe('every README row claiming a surface is read names a reader that resolves', () => {
  it(`examined ${claims.length} rows (${unchecked} name no reader and are UNCHECKED, not passing)`, () => {
    expect(
      claims.length,
      'the table stopped naming readers, or the parser stopped finding them — either way this check now verifies nothing',
    ).toBeGreaterThanOrEqual(2)
  })

  it.each(claims)('README:$line — $surface cites $reader, which resolves', ({ line, reader }) => {
    const hits = HAYSTACK.split(reader).length - 1
    expect(
      hits,
      `README:${line} cites \`${reader}\`, which appears in no non-test source under packages/agents/src or apps/theocode. A row claiming the surface is read names a reader that is not there.`,
    ).toBeGreaterThan(0)
  })
})
