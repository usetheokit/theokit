import { describe, it, expect, beforeAll } from 'vitest'
import { validateProjectStructure, loadConfig } from 'theokit'
import path from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

// Each project below is built here, so the Wave 0 contract owns its own inputs instead of
// depending on a checked-in demo app.
const TEMP_DIR = mkdtempSync(path.join(tmpdir(), 'theo-wave0-'))

beforeAll(() => {
  const validDir = path.join(TEMP_DIR, 'basic-valid-app')
  mkdirSync(path.join(validDir, 'app'), { recursive: true })
  mkdirSync(path.join(validDir, 'server'), { recursive: true })
  writeFileSync(path.join(validDir, 'theo.config.ts'), 'export default {}')
  writeFileSync(path.join(validDir, 'package.json'), '{ "type": "module" }')

  const invalidConfigDir = path.join(TEMP_DIR, 'invalid-config')
  mkdirSync(path.join(invalidConfigDir, 'app'), { recursive: true })
  writeFileSync(path.join(invalidConfigDir, 'package.json'), '{ "type": "module" }')
  writeFileSync(
    path.join(invalidConfigDir, 'theo.config.ts'),
    "export default { port: 'not-a-port' }\n",
  )

  const noAppDir = path.join(TEMP_DIR, 'invalid-no-app')
  mkdirSync(noAppDir, { recursive: true })
  writeFileSync(path.join(noAppDir, 'theo.config.ts'), 'export default {}')
  writeFileSync(path.join(noAppDir, 'package.json'), '{ "type": "module" }')
})

describe('Wave 0 Mandatory Tests', () => {
  // Test 1 — Valid project structure recognized
  it('should recognize a valid project structure', () => {
    expect(() => validateProjectStructure(path.join(TEMP_DIR, 'basic-valid-app'))).not.toThrow()
  })

  // Test 2 — Invalid config fails with clear error
  it('should fail with clear error on invalid config', async () => {
    await expect(loadConfig(path.join(TEMP_DIR, 'invalid-config'))).rejects.toThrow(/port/)
  })

  // Test 3 — Missing app/ fails with clear message
  it('should fail with "Missing required directory: app/" when app/ is missing', () => {
    expect(() => validateProjectStructure(path.join(TEMP_DIR, 'invalid-no-app'))).toThrow(
      'Missing required directory: app/',
    )
  })
})
