/**
 * T4.4 — Rollback runbook MUST exist BEFORE T4.1 publish.
 *
 * Per the 0.3.0 cutover plan v1.1 (EC-5 absorbed): "Author rollback
 * runbook" gives single-maintainer release operations exact copy-pasteable
 * commands so a regression response takes ≤ 5 min instead of 30+ min of
 * improvisation. NEVER `npm unpublish` (destroys the version forever);
 * USE `npm dist-tag add` to point `latest` back to 0.2.1.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const RUNBOOK = resolve(__dirname, '../../docs/runbook/0.3.0-rollback.md')

describe('T4.4 — 0.3.0 rollback runbook', () => {
  it('runbook file exists at the expected path', () => {
    expect(existsSync(RUNBOOK)).toBe(true)
  })

  const content = existsSync(RUNBOOK) ? readFileSync(RUNBOOK, 'utf-8') : ''

  it('contains exact `npm dist-tag add theokit@0.2.1 latest` command', () => {
    expect(content).toMatch(/npm dist-tag add theokit@0\.2\.1 latest/)
  })

  it('contains exact `npm dist-tag add create-theokit@0.2.1 latest` command', () => {
    expect(content).toMatch(/npm dist-tag add create-theokit@0\.2\.1 latest/)
  })

  it('explicitly warns against `npm unpublish` (destroys the version)', () => {
    expect(content).toMatch(/NEVER use npm unpublish/)
  })

  it('has a Decision tree section that triages CSRF/CSP vs unrelated failures', () => {
    expect(content).toMatch(/Decision tree/i)
    expect(content).toMatch(/CSRF\/CSP/)
  })

  it('contains npm deprecate template for the rolled-back version', () => {
    expect(content).toMatch(/npm deprecate theokit@0\.3\.0/)
  })

  it('contains a verification step (npm view returns 0.2.1)', () => {
    expect(content).toMatch(/npm view theokit@latest version/)
  })

  it('cross-links the 0.3.0 cutover plan', () => {
    expect(content).toMatch(/theokit-0-3-0-enforcement-cutover-plan/)
  })

  it('cross-links ADR-0023 (in-house aligned with peers)', () => {
    expect(content).toMatch(/0023-csp-csrf-in-house-aligned-with-peers|ADR-0023/)
  })
})
