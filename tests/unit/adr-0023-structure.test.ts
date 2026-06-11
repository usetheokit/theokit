/**
 * T1.2 — ADR-0023 structure verification.
 *
 * Locks the in-house CSRF/CSP decision documented in the 0.3.0 cutover plan
 * v1.1 (ADR D3 in the plan + blueprint Q3 confirming-negative across 4 peer
 * frameworks). Required by plan task T1.2 before T4.3 promote `latest`.
 *
 * MADR 3.0 format per existing ADR style (e.g., 0008-theoplugin-is-the-canonical-sdk.md).
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ADR_PATH = resolve(__dirname, '../../docs/adr/0023-csp-csrf-in-house-aligned-with-peers.md')
const MIGRATION_GUIDE = resolve(__dirname, '../../docs/migration/0.2-to-0.3.md')

describe('T1.2 — ADR-0023 locks in-house CSRF/CSP decision', () => {
  it('ADR file exists at the expected path', () => {
    expect(existsSync(ADR_PATH)).toBe(true)
  })

  const content = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : ''

  it('has MADR 3.0 frontmatter (Status, Date, Deciders, Tags)', () => {
    expect(content).toMatch(/\*\s*Status:\s*accepted/i)
    expect(content).toMatch(/\*\s*Date:\s*2026-06-02/)
    expect(content).toMatch(/\*\s*Deciders:/)
    expect(content).toMatch(/\*\s*Tags:.*security/i)
  })

  it('has ## Context and Problem Statement section', () => {
    expect(content).toMatch(/^## Context and Problem Statement\b/m)
  })

  it('has ## Decision Outcome section', () => {
    expect(content).toMatch(/^## Decision Outcome\b/m)
  })

  it('explicitly rejects csurf, helmet, and csp-* deps', () => {
    expect(content).toMatch(/csurf/)
    expect(content).toMatch(/helmet/)
    expect(content).toMatch(/csp-/)
  })

  it('cites the 4 peer frameworks (Next.js, SvelteKit, Astro, Remix)', () => {
    expect(content).toMatch(/Next\.js/)
    expect(content).toMatch(/SvelteKit/)
    expect(content).toMatch(/Astro/)
    expect(content).toMatch(/Remix/)
  })

  it('cites the blueprint as evidence source', () => {
    expect(content).toMatch(/blueprint|theokit-0-3-0-enforcement-cutover-blueprint/i)
  })

  it('has ## Consequences section', () => {
    expect(content).toMatch(/^## Consequences\b/m)
  })

  it('migration guide backlinks to ADR-0023', () => {
    const migration = readFileSync(MIGRATION_GUIDE, 'utf-8')
    expect(migration).toMatch(/ADR-0023|0023-csp-csrf-in-house-aligned-with-peers/)
  })
})
