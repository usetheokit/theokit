/**
 * T1.1 — Verify the 0.2→0.3 migration guide documents the `csrf: 'warn'`
 * config-flag opt-out as a migration aid. The existing `## Rollback` section
 * (L240+) is expanded with `### Opt-out via config flag` per plan v1.1
 * (EC-1 absorbed — do NOT create a duplicate `## Rollback / opt-out` heading).
 *
 * Anchor canon: `#rollback` (existing). Used by T1.3 (scanner URL emit) +
 * T3.1 (CHANGELOG migration-URL pattern).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION_GUIDE = resolve(__dirname, '../../docs/migration/0.2-to-0.3.md')

describe('T1.1 — migration guide ## Rollback section documents csrf: "warn" opt-out', () => {
  const content = readFileSync(MIGRATION_GUIDE, 'utf-8')

  it('contains exactly one ## Rollback heading (no duplicate from EC-1)', () => {
    const rollbackHeadings = content.match(/^## Rollback\b/gm) ?? []
    expect(rollbackHeadings.length).toBe(1)
  })

  it('does NOT contain a duplicate "## Rollback / opt-out" heading', () => {
    expect(content).not.toMatch(/^## Rollback \/ opt-out\b/m)
  })

  it('contains an ### Opt-out via config flag subsection under ## Rollback', () => {
    expect(content).toMatch(/^### Opt-out via config flag\b/m)
  })

  it('shows the literal csrf: "warn" config example', () => {
    expect(content).toMatch(/csrf:\s*['"]warn['"]/)
  })

  it('shows the literal cspMode: "report-only" config example', () => {
    expect(content).toMatch(/cspMode:\s*['"]report-only['"]/)
  })

  it('frames the opt-out as a migration aid, not a long-term setting', () => {
    expect(content).toMatch(/migration aid/i)
  })
})
