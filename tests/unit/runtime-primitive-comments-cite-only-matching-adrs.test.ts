import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The storage, jobs, cron, webhook, cost and security sources cited `docs/adr/0002..0010` for
 * decisions those documents do not record: the numbers came from an older ADR series, and the
 * current series reused them for unrelated subjects (usetheokit/theokit#1025, after #886 fixed one
 * instance). `scripts/check-doc-citations.mjs` checks that a cited number EXISTS, so a citation of
 * the wrong existing ADR passes it.
 *
 * This test pins the directories that were audited by hand. A citation added to them later has to
 * be added here too, which is the moment someone opens the ADR and checks that it is about the
 * thing the comment says.
 */
const ROOT = resolve(import.meta.dirname, '../..')

const AUDITED_DIRS = [
  'packages/theo/src/server/storage',
  'packages/theo/src/server/jobs',
  'packages/theo/src/server/cron',
  'packages/theo/src/server/webhook',
  'packages/theo/src/server/cost',
  'packages/theo/src/server/security',
]

/**
 * `path|ADR` pairs read against the ADR they cite. `use-unstorage.ts` quotes the citation #886
 * removed, as history; it is not a claim that the ADR applies.
 */
const VERIFIED = new Set(['packages/theo/src/server/storage/use-unstorage.ts|0009'])

function citations(): string[] {
  let out = ''
  try {
    out = execFileSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
      'git',
      ['-C', ROOT, 'grep', '-n', '-o', '-E', String.raw`ADR[- ][0-9]{4}`, '--', ...AUDITED_DIRS],
      { encoding: 'utf-8' },
    )
  } catch (err) {
    // `git grep` exits 1 when nothing matches, which is a valid state for these directories.
    if ((err as { status?: number }).status !== 1) throw err
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [file, , match] = line.split(':')
      return `${file}|${match.slice(-4)}`
    })
}

describe('ADR citations in the runtime primitives', () => {
  it('cite only ADRs that were checked against the subject of the comment', () => {
    const unverified = citations().filter((pair) => !VERIFIED.has(pair))
    expect(unverified).toEqual([])
  })
})
