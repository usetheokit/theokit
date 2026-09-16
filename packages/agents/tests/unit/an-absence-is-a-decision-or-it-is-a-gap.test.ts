import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * B-074 — an absence that reads as an oversight is re-investigated at full cost by the next person.
 *
 * The `.claude` sweep produced a table with absences in it, and shipping that without separating
 * "we decided not to" from "we have not got to it" reproduces the defect this backlog exists to
 * close. Four decisions across three files — `keybindings.json`, `themes/*.json`, and
 * `~/.claude.json` split into its two halves — are now declared where a reader meets them.
 *
 * ## Why the README and not only the rule
 *
 * `.claude/rules/foreign-config-surfaces.md` is this project's source of truth and is **gitignored**,
 * so nothing in it reaches somebody who installs the package. The README is the copy that travels.
 * A decision recorded only in the rule is a decision made for one checkout.
 *
 * ## Why a test at all
 *
 * Without one, the declaration is prose that nothing verifies, which is the same shape as the
 * capability-with-no-caller this backlog keeps finding — one genre over. These cases assert the
 * three properties the item's Definition of Done names, not the wording.
 */
const README = readFileSync(join(import.meta.dirname, '..', '..', 'README.md'), 'utf8')

/**
 * Every verdict a row is allowed to carry. Closed on purpose: a new word is how `refused` (a
 * decision) and `not read yet` (a gap) collapse into one thing a reader cannot act on.
 */
const VERDICTS = [
  'read',
  'translated',
  'parsed, not applied',
  'resolvable',
  'refused',
  'out of scope',
  'not read yet',
] as const

/**
 * The verdict a row declares: its second cell, with the bold markers stripped. Every verdict in the
 * table OPENS its cell, which is what makes this checkable — `startsWith` refuses `planned to be
 * read later`, where a substring match would find `read` in it and pass.
 */
const verdictOf = (row: string): string =>
  (row.split('|')[2] ?? '').trim().replace(/^\*\*/, '').toLowerCase()

/**
 * Just the `## Foreign configuration surfaces` section. The README holds more than one table and
 * the other one's first column is an import path, so a file-wide row filter reads rows that were
 * never surface verdicts.
 */
const SURFACES_TABLE = README.slice(README.indexOf('## Foreign configuration surfaces')).split(
  '\n## ',
)[0]

const OUT_OF_SCOPE = ['keybindings.json', 'themes/*.json'] as const

describe('an absence is a decision, or it is a gap', () => {
  /** The surface's row in the table, or `undefined` — prose elsewhere in the file does not count. */
  const verdictRowFor = (surface: string): string | undefined =>
    README.split('\n').find((l) => l.startsWith('| ') && l.includes(surface) && l.includes('|', 2))

  it.each(OUT_OF_SCOPE)('gives %s a row in the table, with a verdict', (surface) => {
    // Asserted as a ROW rather than as a substring, and the difference was measured: the first
    // version used `toContain(surface)`, and deleting the table row left it green because the same
    // name appears in the prose below — prose this test's own author wrote. An assertion that
    // passes from the explanation of a decision, rather than from the decision, verifies nothing.
    const row = verdictRowFor(surface)

    expect(row, `${surface} has no row, so its absence reads as an oversight`).toBeDefined()
    expect(row, `${surface}'s row carries no verdict`).toMatch(/out of scope|refused|read/)
  })

  it('never says "out of scope" without naming who owns it instead', () => {
    // The DoD's third bullet. "Not supported" with no successor sends the reader looking.
    //
    // `the consumer` joined the list on 2026-09-15, and the reason is the finding that put it
    // there: `keybindings.json` was attributed to `@theokit/tui`, and re-measuring showed the
    // toolkit carries internal keybindings and reads no file while `theocode` reads
    // `~/.claude/keybindings.json` itself. Naming a package that does the least with a surface
    // satisfies the letter of this test and defeats it — the reader still ends up in the wrong
    // repository. What the rule asks for is a successor the reader can go to, and the consumer is
    // one. for a bug.
    // Rows, not every line. The sibling case above already learned this — "an assertion that
    // passes from the explanation of a decision, rather than from the decision, verifies" the
    // wrong thing — and this one was still scanning prose, so a sentence ABOUT the defect tripped
    // it while every verdict row passed. Measured 2026-09-15 on a paragraph explaining why an
    // earlier attribution was wrong.
    for (const line of OUT_OF_SCOPE.map(verdictRowFor).filter(
      (r): r is string => r !== undefined,
    )) {
      // `nobody` joined on 2026-09-16, and it is a successor rather than a hole in the rule.
      // `themes/*.json` was attributed to `@theokit/tui` while this file's own prose said the row
      // "names no owner, because inventing one is exactly the mistake the `keybindings.json` row
      // already made". The document contradicted itself and the row is the half a reader checks.
      // Re-measured: no package in the ecosystem reads a theme file. An ownership that does not
      // exist is still an answer, and it is the one that stops a reader hunting for a fourth
      // package. What this rule forbids is SILENCE about the successor, not a measured absence.
      expect(
        /@theokit\/tui|a CLI's own state|the consumer|nobody/.test(line),
        `"${line.trim()}" refuses a surface without naming who owns it`,
      ).toBe(true)
    }
  })

  it('splits `~/.claude.json` rather than deciding it whole', () => {
    // The DoD's second bullet, and the one a summary would flatten. The file holds a CLI's session
    // state AND the operator's personal-scope MCP servers; those belong to different owners, so one
    // verdict over the whole file would be wrong about one half whichever way it went.
    //
    // This asserted the literal words `out of scope` and `not read yet` until 2026-09-16, which
    // pinned the WORLD rather than the document: the MCP half was undone when the test was written
    // and `loadPersonalMcpServers` closed it, so a test guarding the split failed because the gap it
    // described got fixed. What the split means is that the two halves are judged SEPARATELY — so
    // that is what is asserted, and it survives either half changing verdict again.
    const rows = README.split('\n').filter(
      (l) => l.startsWith('| ') && l.includes('~/.claude.json'),
    )

    expect(
      rows.length,
      '`~/.claude.json` got a single verdict, so one of its halves is misfiled',
    ).toBeGreaterThanOrEqual(2)

    const verdicts = new Set(rows.map((r) => VERDICTS.find((v) => verdictOf(r).startsWith(v))))
    expect(verdicts.has(undefined), 'a `~/.claude.json` row carries no verdict at all').toBe(false)
    expect(
      verdicts.size,
      'both halves of `~/.claude.json` got the same verdict, which is deciding it whole',
    ).toBeGreaterThanOrEqual(2)
  })

  it('keeps an undone surface distinguishable from a refused one', () => {
    // The whole point of the item: the two must not collapse into one word. A reader deciding
    // whether to file a bug needs to know which one they are looking at.
    //
    // It used to assert that the string `not read yet` appears somewhere in the README. That held
    // only while some surface was undone. Closing the last one — `loadPersonalMcpServers`, the same
    // day — emptied the phrase of any referent and the assertion started demanding that the document
    // describe a gap the package no longer has. A test that fails when a gap is CLOSED is pointed
    // the wrong way round.
    //
    // The property that actually protects the reader is that the vocabulary stays CLOSED: a row may
    // not invent a word. `partial`, `planned`, `supported` are exactly how "refused" and "not done"
    // collapse, because each reads as either one depending on who is looking.
    // Scoped to the section, not to the file. The first version filtered every line in the README
    // starting with "| `" and picked up the subpath-export table, whose first column is an import
    // path — so the test failed on a row that was never a surface verdict and never could be.
    const rows = SURFACES_TABLE.split('\n').filter(
      (l) => l.startsWith('| `') && !l.startsWith('| ---'),
    )
    expect(rows.length, 'the surfaces table is gone, so this test guards nothing').toBeGreaterThan(
      8,
    )

    for (const row of rows) {
      expect(
        VERDICTS.some((v) => verdictOf(row).startsWith(v)),
        `"${row.trim()}" opens with a verdict outside ${VERDICTS.join(' / ')}`,
      ).toBe(true)
    }
  })
})
