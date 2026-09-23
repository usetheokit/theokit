import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

/**
 * B-258 — a citation that RESOLVES and supports nothing.
 *
 * `server/storage/use-unstorage.ts` read "see ADR-0009 (`unstorage` adoption for KV drivers)" for as
 * long as it existed. ADR-0009 is about esbuild's postinstall, and `grep -rl unstorage docs/` exits
 * 1: no ADR records that decision under any number. The existing `check-doc-citations.mjs` could not
 * see it, because the NUMBER resolves — a file with that number is there — and only the SUBJECT is
 * wrong.
 *
 * ## What this checks, and the class it deliberately does not
 *
 * A citation carrying the full path names the file it expects: `docs/adr/0009-unstorage-adoption-for-kv.md`.
 * That is checkable with certainty — the file either has that name at that number or it does not — so
 * this test checks it.
 *
 * A citation carrying only the number (`ADR-0009`, or `ADR-0009 (some description)`) is NOT checkable
 * without guessing. Measured while writing this: comparing a parenthesised description against the
 * ADR's title flagged **13 of 16** such citations, and reading them showed most were legitimate —
 * the description names a CONSEQUENCE of the decision, not the document's title. An 81% flag rate is
 * noise, and a gate that flags four out of five is a gate somebody switches off. So that class stays
 * unmechanised, and this comment is the declaration rather than a silence.
 *
 * ## Why every ADR directory, not just the root one
 *
 * The first version of this check compared against `docs/adr/` alone and reported 7 actionable
 * breakages. `apps/theocode/docs/adr/` exists and holds its own numbered ADRs, so 5 of those 7 were
 * my own measurement error — including one citation that named a file which does exist. The honest
 * count against every directory is 2.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// git by absolute path, never through PATH. `sonarjs/no-os-command-from-path` is right that a
// writable PATH entry decides which binary runs, and this test asks git which files the repository
// tracks — an answer from the wrong binary is an answer about the wrong repository.
const GIT = '/usr/bin/git'
const CITATION = /docs\/adr\/(\d{4})-([a-z0-9-]+)\.md/g

/** Every `NNNN-slug` that exists, across every ADR directory in the tree. */
function existingAdrs(): Set<string> {
  const dirs = execFileSync(GIT, ['ls-files', '--', '*docs/adr/*.md'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map((p) => dirname(p))
  const found = new Set<string>()
  for (const dir of new Set(dirs)) {
    for (const name of readdirSync(join(repoRoot, dir))) {
      const m = /^(\d{4})-(.+)\.md$/.exec(name)
      if (m) found.add(`${m[1]}-${m[2]}`)
    }
  }
  return found
}

describe('an ADR path citation names the real file (B-258)', () => {
  const real = existingAdrs()

  it('test_the_adr_directories_were_found', () => {
    // Guards the check. A glob that stopped matching would make the assertion below pass over an
    // empty set, reporting every citation as broken — or, with the comparison inverted, none.
    expect(real.size, 'no ADRs were found in any docs/adr directory').toBeGreaterThan(15)
  })

  it('test_no_source_file_cites_an_adr_path_that_does_not_exist', () => {
    // Tracked AND untracked-but-not-ignored. `ls-files` alone lists only what git already knows,
    // and a file added in the working tree is exactly where a fresh citation appears — measured:
    // a new `.ts` carrying `docs/adr/0099-this-does-not-exist.md` left this test green. The CI run
    // would have caught it after the commit; the point of a local check is to catch it before.
    const listed = [
      execFileSync(GIT, ['ls-files', '--', '*.ts', '*.tsx', '*.mjs'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }),
      execFileSync(
        GIT,
        ['ls-files', '--others', '--exclude-standard', '--', '*.ts', '*.tsx', '*.mjs'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
        },
      ),
    ].join('\n')
    const tracked = listed
      .split('\n')
      .filter(Boolean)
      // A fixture in a checker's own test names a deliberately absent ADR; that is its subject.
      .filter((p) => !p.includes('.test.'))

    const broken: string[] = []
    for (const path of tracked) {
      let src: string
      try {
        src = readFileSync(join(repoRoot, path), 'utf8')
      } catch {
        continue
      }
      const lines = src.split('\n')
      for (const [index, line] of lines.entries()) {
        // The repository's own exemption marker, already parsed by `scripts/check-doc-citations.mjs`.
        // A line may name an absent ADR on purpose: a checker's docblock describing the defect it was
        // written for MENTIONS the path rather than citing it, and telling those apart by reading is
        // not something a regex does. An exemption with no reason after the colon does not count —
        // the same rule `rules/english-only.md` applies for the same reason.
        if (/adr-citation-ok:\s*\S/.test(line)) continue
        for (const m of line.matchAll(CITATION)) {
          const key = `${m[1]}-${m[2]}`
          if (!real.has(key)) {
            broken.push(
              `${path}:${String(index + 1)} cites docs/adr/${key}.md, which does not exist`,
            )
          }
        }
      }
    }

    expect(
      broken,
      'a source file names an ADR path that is not on disk. Either fix the path or drop the citation:\n' +
        broken.join('\n'),
    ).toEqual([])
  })
})
