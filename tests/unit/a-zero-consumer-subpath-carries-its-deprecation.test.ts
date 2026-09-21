import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * B-211, second DoD bullet: `docs/adr/0007`, `docs/program/capability-matrix.md` and
 * `packages/http/src` agree on how many zero-consumer subpaths exist.
 *
 * They did not. The matrix recorded three `@theokit/http` subpaths with no consumer; the source
 * carried two `@deprecated` markers. ADR 0007 measured the third on 2026-09-20 and said, in its
 * own correction, that extending an accepted decision to a symbol nobody argued about would be
 * widening it rather than applying it — so it registered the third rather than absorbing it.
 *
 * This asserts the agreement mechanically, in the direction that matters: the matrix is the list
 * somebody maintains, so every row it carries must be answered in the source. A subpath added to
 * the matrix tomorrow fails here until it is decided.
 */
const MATRIX = 'docs/program/capability-matrix.md'
const SUBPATH = '`@theokit/http/'

/** The file a matrix row names, or undefined when the line is not one of its rows. */
function fileNamedBy(line: string): string | undefined {
  const cells = line.split('|').map((c) => c.trim())
  if (cells.length < 4 || !cells[1].startsWith(SUBPATH)) return undefined
  return cells[2].replaceAll('`', '').split(':')[0]
}

describe('a zero-consumer subpath carries its deprecation', () => {
  it('test_every_http_subpath_the_matrix_records_is_deprecated_in_source', () => {
    const rows = readFileSync(join(process.cwd(), MATRIX), 'utf8')
      .split('\n')
      .map(fileNamedBy)
      .filter((p): p is string => p !== undefined)

    // Printed as an assertion rather than trusted: a matrix row whose shape drifts would make this
    // test pass by reading nothing, which is the failure it is written against.
    expect(
      rows.length,
      `no \`@theokit/http/*\` row parsed out of ${MATRIX}`,
    ).toBeGreaterThanOrEqual(3)

    const undeclared = rows.filter(
      (path) => !readFileSync(join(process.cwd(), path), 'utf8').includes('@deprecated'),
    )

    expect(
      undeclared,
      `the matrix records these as having no consumer and the source says nothing:\n${undeclared.join('\n')}`,
    ).toEqual([])
  })
})
