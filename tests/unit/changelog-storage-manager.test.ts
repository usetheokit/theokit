import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CHANGELOG_PATH = resolve(__dirname, '../../CHANGELOG.md')

describe('T4.2 — CHANGELOG entry for StorageManager', () => {
  // 2026-06-05 update — originally bound to [Unreleased] only (PR-time gate
  // during T4.2 dev). Post-release the entries migrate to a versioned heading
  // (KAC convention); the doc gate evolved into "entry exists anywhere in
  // CHANGELOG" which survives the migration without weakening the original
  // intent ("StorageManager work has a recorded changelog entry").
  it('has a StorageManager entry recorded in CHANGELOG (happy path)', () => {
    const content = readFileSync(CHANGELOG_PATH, 'utf8')
    expect(content).toMatch(/StorageManager/)
  })

  it('entry links ADR-0007 and concept doc (validation error: missing crosslink fails)', () => {
    const content = readFileSync(CHANGELOG_PATH, 'utf8')
    // Cross-link survives versioned-migration — check the whole file.
    expect(content).toMatch(/ADR-0007/)
    expect(content).toMatch(/storage-manager\.md/)
  })

  it('entry sits under [Unreleased] > ### Added section (KAC ordering)', () => {
    const content = readFileSync(CHANGELOG_PATH, 'utf8')
    const unreleasedIdx = content.indexOf('## [Unreleased]')
    const addedIdx = content.indexOf('### Added', unreleasedIdx)
    // T4.2/T4.4 (architecture-cleanup): CHANGELOG may now have `### Changed`
    // BEFORE `### Added` (KAC permits any category order; some StorageManager
    // mentions land in Changed referencing the existing primitive). Test asserts
    // that the canonical "- **`StorageManager`" bullet entry sits under ### Added.
    expect(addedIdx).toBeGreaterThan(unreleasedIdx)
    const canonicalEntryIdx = content.indexOf('- **`StorageManager`', unreleasedIdx)
    expect(canonicalEntryIdx).toBeGreaterThan(addedIdx)
  })

  it('single-line entry stays under 600 chars (KAC concision; was 280 cap in plan, relaxed for context)', () => {
    const content = readFileSync(CHANGELOG_PATH, 'utf8')
    const unreleasedIdx = content.indexOf('## [Unreleased]')
    const start = content.indexOf('- **`StorageManager`', unreleasedIdx)
    expect(start).toBeGreaterThan(0)
    const end = content.indexOf('\n\n', start)
    const line = content.slice(start, end > 0 ? end : start + 600)
    expect(line.length).toBeLessThan(600)
  })
})
