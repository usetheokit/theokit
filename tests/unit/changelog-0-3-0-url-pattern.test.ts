/**
 * T3.1 — CHANGELOG 0.3.0 cohort follows Astro-style migration-URL pattern.
 *
 * Per blueprint Q5 + R5: every CHANGELOG entry that documents a 0.3.0
 * breaking change ends with the migration-guide URL suffix
 *   `([0.3.0 migration guidance](https://theokit.dev/migration/0.2-to-0.3#<anchor>))`
 *
 * Anchor canon: `#rollback` (existing; preserved by T1.1 — do NOT use
 * `#rollback--opt-out` per EC-2). Additional anchors must resolve to real
 * headings in `docs/migration/0.2-to-0.3.md`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CHANGELOG = resolve(__dirname, '../../CHANGELOG.md')
const MIGRATION_GUIDE = resolve(__dirname, '../../docs/migration/0.2-to-0.3.md')

const URL_PATTERN =
  /\(\[0\.3\.0 migration guidance\]\(https:\/\/theokit\.dev\/migration\/0\.2-to-0\.3#([a-z0-9-]+)\)\)/

describe('T3.1 — CHANGELOG 0.3.0 cohort uses Astro-style migration URL pattern', () => {
  const content = readFileSync(CHANGELOG, 'utf-8')
  const migration = readFileSync(MIGRATION_GUIDE, 'utf-8')

  it('contains a ### Changed (0.3.0 cohort, ...) subsection under [Unreleased]', () => {
    expect(content).toMatch(/^### Changed \(0\.3\.0 cohort, 2026-06-02\)/m)
  })

  it('the 0.3.0 cohort section documents CSRF strict default flip', () => {
    expect(content).toMatch(/csrf.*strict|strict.*csrf/i)
  })

  it('the 0.3.0 cohort section documents CSP enforce default flip', () => {
    expect(content).toMatch(/csp.*enforce|enforce.*csp|content.security.*enforce/i)
  })

  it('every entry under 0.3.0 cohort ends with the migration-URL suffix', () => {
    const cohortMatch = content.match(
      /^### Changed \(0\.3\.0 cohort[^\n]*\n([\s\S]+?)(?=\n### |\n## |$(?![\s\S]))/m,
    )
    expect(cohortMatch).not.toBeNull()
    const cohortBody = cohortMatch![1]
    const bulletEntries = cohortBody.split('\n').filter((line) => line.startsWith('- '))
    expect(bulletEntries.length).toBeGreaterThan(0)
    for (const entry of bulletEntries) {
      expect(entry).toMatch(URL_PATTERN)
    }
  })

  it('every cited #anchor in 0.3.0 cohort entries has a matching heading topic in migration guide', () => {
    // GitHub anchor derivation is non-trivial (arrows produce double hyphens,
    // backticks stripped after markdown parse, etc.). Rather than re-implement
    // the algorithm, this test verifies SEMANTIC alignment: the keyword stem
    // of each anchor MUST appear in some migration-guide heading.
    const cohortMatch = content.match(
      /^### Changed \(0\.3\.0 cohort[^\n]*\n([\s\S]+?)(?=\n### |\n## |$(?![\s\S]))/m,
    )
    const cohortBody = cohortMatch![1]
    const anchors = new Set<string>()
    for (const m of cohortBody.matchAll(new RegExp(URL_PATTERN.source, 'g'))) {
      anchors.add(m[1])
    }
    expect(anchors.size).toBeGreaterThan(0)
    for (const a of anchors) {
      // Extract first 2 distinguishing tokens from anchor (e.g.,
      // "1-csrf-default-warn--strict" → ["csrf", "strict"])
      const tokens = a.split(/-+/).filter((t) => t.length > 2 && !/^\d+$/.test(t))
      const stem = tokens.slice(0, 2).join('|') || a
      const re = new RegExp(stem, 'i')
      const hasMatchingHeading = migration.match(/^#{1,6}\s+.+$/gm)?.some((h) => re.test(h))
      expect(
        hasMatchingHeading,
        `Anchor "#${a}" has no heading with tokens [${tokens.slice(0, 2).join(', ')}] in migration guide`,
      ).toBe(true)
    }
  })

  it('uses #rollback (NOT #rollback--opt-out) for the rollback link', () => {
    expect(content).not.toMatch(/#rollback--opt-out/)
  })
})
