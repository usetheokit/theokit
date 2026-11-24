import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readForeignImport, writeForeignImport } from '@theokit/agents/foreign-setup'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { readImportAtStart } from '../src/migration/import-start.js'
import { copyFixture, readClaudeCodeSetup, readHermesSetup } from './migration-fixtures.js'

const now = new Date('2026-10-31T12:00:00Z')

/** The store lives in `@theokit/agents/foreign-setup`; these cover the fixtures and the app's error mapping. */
describe('the stored import in TheoClaw', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'theoclaw-migration-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('imports both fixtures in under 2000 ms', () => {
    const claude = copyFixture('claude-code', join(dir, 'claude'))
    const hermes = copyFixture('hermes', join(dir, 'hermes'))
    const started = performance.now()

    writeForeignImport(join(dir, 'state-claude'), readClaudeCodeSetup({ home: join(claude, 'home'), project: join(claude, 'project') }), { now })
    writeForeignImport(join(dir, 'state-hermes'), readHermesSetup({ root: hermes }), { now })

    expect(performance.now() - started).toBeLessThan(2000)
    expect(readForeignImport(join(dir, 'state-hermes'))?.counts).toEqual({ instructions: 2, memories: 2, skills: 1, mcpServers: 2 })
  })


  it('maps an unreadable stored import to a TheoClawConfigError naming THEOCLAW_STATE_DIR', () => {
    const stateDir = join(dir, 'state')
    mkdirSync(join(stateDir, 'import'), { recursive: true })
    writeFileSync(join(stateDir, 'import', 'manifest.json'), '{')

    const error = (() => {
      try {
        readImportAtStart({ THEOCLAW_STATE_DIR: stateDir }, () => {})
      } catch (caught) {
        return caught
      }
      throw new Error('the import was read')
    })()

    expect(error).toBeInstanceOf(TheoClawConfigError)
    expect((error as TheoClawConfigError).variable).toBe('THEOCLAW_STATE_DIR')
    expect((error as TheoClawConfigError).message).toContain('manifest.json')
  })
})
