import { describe, it, expect, beforeAll } from 'vitest'
import { validateProjectStructure, TheoProjectError } from 'theokit'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The valid and app-less projects are built here, so the suite owns its own inputs.
const TEMP_DIR = mkdtempSync(path.join(tmpdir(), 'theo-validate-'))

beforeAll(() => {
  // A structurally valid project: app/ + server/ + config + manifest.
  const validDir = path.join(TEMP_DIR, 'basic-valid-app')
  mkdirSync(path.join(validDir, 'app'), { recursive: true })
  mkdirSync(path.join(validDir, 'server'), { recursive: true })
  writeFileSync(path.join(validDir, 'theo.config.ts'), 'export default {}')
  writeFileSync(path.join(validDir, 'package.json'), '{ "type": "module" }')

  // A project that exists but has no app/ — the single-error case.
  const noAppDir = path.join(TEMP_DIR, 'invalid-no-app')
  mkdirSync(noAppDir, { recursive: true })
  writeFileSync(path.join(noAppDir, 'theo.config.ts'), 'export default {}')
  writeFileSync(path.join(noAppDir, 'package.json'), '{ "type": "module" }')

  // Create a temp dir without app/ and without theo.config.ts (for multi-error test)
  const multiErrorDir = path.join(TEMP_DIR, 'multi-error')
  mkdirSync(multiErrorDir, { recursive: true })
  writeFileSync(path.join(multiErrorDir, 'package.json'), '{ "type": "module" }')
  // No app/ and no theo.config.ts

  // Create a temp dir without optional dirs (but with required ones)
  const minimalDir = path.join(TEMP_DIR, 'minimal-valid')
  mkdirSync(path.join(minimalDir, 'app'), { recursive: true })
  writeFileSync(path.join(minimalDir, 'theo.config.ts'), 'export default {}')
  writeFileSync(path.join(minimalDir, 'package.json'), '{ "type": "module" }')
})

describe('validateProjectStructure', () => {
  it('should accept a valid project structure', () => {
    expect(() => validateProjectStructure(path.join(TEMP_DIR, 'basic-valid-app'))).not.toThrow()
  })

  it('should fail when app/ directory is missing', () => {
    expect(() => validateProjectStructure(path.join(TEMP_DIR, 'invalid-no-app'))).toThrow(
      'Missing required directory: app/',
    )
  })

  it('should throw TheoProjectError instance', () => {
    try {
      validateProjectStructure(path.join(TEMP_DIR, 'invalid-no-app'))
    } catch (e) {
      expect(e).toBeInstanceOf(TheoProjectError)
    }
  })

  it('should accept project without optional directories', () => {
    expect(() => validateProjectStructure(path.join(TEMP_DIR, 'minimal-valid'))).not.toThrow()
  })

  it('should collect all errors in one throw', () => {
    try {
      validateProjectStructure(path.join(TEMP_DIR, 'multi-error'))
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(TheoProjectError)
      const err = e as TheoProjectError
      expect(err.errors.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('should fail when rootDir does not exist (EC-3)', () => {
    expect(() => validateProjectStructure('/nonexistent/path/that/does/not/exist')).toThrow(
      'Project directory does not exist',
    )
  })
})
