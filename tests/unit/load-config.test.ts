import { describe, it, expect, beforeAll } from 'vitest'
import { loadConfig, TheoConfigError } from 'theokit'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Every project this file loads is built here, so the suite owns its own inputs.
const TEMP_DIR = mkdtempSync(path.join(tmpdir(), 'theo-test-'))

beforeAll(() => {
  // Temp dir without theo.config.ts
  mkdirSync(path.join(TEMP_DIR, 'no-config'), { recursive: true })

  // A valid project: app/ + server/ + an explicit config.
  const validDir = path.join(TEMP_DIR, 'basic-valid-app')
  mkdirSync(path.join(validDir, 'app'), { recursive: true })
  mkdirSync(path.join(validDir, 'server'), { recursive: true })
  writeFileSync(path.join(validDir, 'package.json'), '{ "type": "module" }')
  writeFileSync(
    path.join(validDir, 'theo.config.ts'),
    "export default { port: 3000, appDir: 'app', serverDir: 'server' }\n",
  )

  // A project whose config fails validation on `port`.
  const invalidDir = path.join(TEMP_DIR, 'invalid-config')
  mkdirSync(path.join(invalidDir, 'app'), { recursive: true })
  writeFileSync(path.join(invalidDir, 'package.json'), '{ "type": "module" }')
  writeFileSync(path.join(invalidDir, 'theo.config.ts'), "export default { port: 'not-a-port' }\n")

  // These two omitted the `package.json` their siblings above declare, and that omission — not the
  // product — is the whole of usetheokit/theokit#418's first failure. Without a nearest
  // `"type": "module"`, a `.ts` file is ambiguous, the loader's tsx fallback transpiles it for CJS,
  // and the emitted `__filename` is undefined when it is then evaluated as ESM. Measured on Node
  // 22.12.0, the declared floor: the test reported
  // `_file: __filename is not defined in ES module scope` while `loadConfig` OUTSIDE vitest
  // produced the correct `_export` error and loaded a real config fine. The fixture was less
  // faithful than reality — every app `create-theokit` scaffolds declares the field.

  // Temp dir with config exporting null
  const nullDir = path.join(TEMP_DIR, 'null-config')
  mkdirSync(nullDir, { recursive: true })
  writeFileSync(path.join(nullDir, 'package.json'), '{ "type": "module" }')
  writeFileSync(path.join(nullDir, 'theo.config.ts'), 'export default null')

  // Temp dir with syntax error config
  const syntaxDir = path.join(TEMP_DIR, 'syntax-error-config')
  mkdirSync(syntaxDir, { recursive: true })
  writeFileSync(path.join(syntaxDir, 'package.json'), '{ "type": "module" }')
  writeFileSync(path.join(syntaxDir, 'theo.config.ts'), 'export default {{{')
})

describe('loadConfig', () => {
  it('should load and validate a valid config', async () => {
    const config = await loadConfig(path.join(TEMP_DIR, 'basic-valid-app'))
    expect(config.port).toBe(3000)
    expect(config.appDir).toBe('app')
    expect(config.serverDir).toBe('server')
  })

  it('should throw TheoConfigError for invalid config', async () => {
    await expect(loadConfig(path.join(TEMP_DIR, 'invalid-config'))).rejects.toThrow(/port/)
  })

  it('should return defaults when config file is missing', async () => {
    const config = await loadConfig(path.join(TEMP_DIR, 'no-config'))
    expect(config.appDir).toBe('app')
    expect(config.serverDir).toBe('server')
    expect(config.port).toBe(3000)
  })

  it('should throw TheoConfigError instance', async () => {
    try {
      await loadConfig(path.join(TEMP_DIR, 'invalid-config'))
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(TheoConfigError)
    }
  })

  it('should throw TheoConfigError for config with syntax error (EC-2)', async () => {
    try {
      await loadConfig(path.join(TEMP_DIR, 'syntax-error-config'))
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(TheoConfigError)
      expect((e as TheoConfigError).message).toContain('theo.config.ts')
    }
  })

  it('should throw clear message when config exports null (EC-6)', async () => {
    await expect(loadConfig(path.join(TEMP_DIR, 'null-config'))).rejects.toThrow(
      /must use export default defineConfig/,
    )
  })
})
