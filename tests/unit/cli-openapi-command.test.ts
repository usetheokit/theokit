/**
 * T2.3 — `theokit openapi` standalone CLI command.
 *
 * Mirrors trpc's `pnpm codegen` pattern: regenerate
 * `<distDir>/openapi.json` without a full Vite build. Useful in dev
 * workflows when only schemas changed.
 *
 * Tests: source-level assertions on registration + unit test of the
 * command itself with stub loader.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CLI_INDEX = resolve(__dirname, '../../packages/theo/src/cli/index.ts')

describe('T2.3 — cli/index.ts registers `openapi` command', () => {
  it('registers the `openapi` command with cac', () => {
    const src = readFileSync(CLI_INDEX, 'utf-8')
    // Allow whitespace/newlines after `.command(` (long descriptions wrap).
    expect(src).toMatch(/\.command\(\s*['"]openapi['"]/)
  })

  it('dynamic-imports openapiCommand from commands/openapi.js', () => {
    const src = readFileSync(CLI_INDEX, 'utf-8')
    expect(src).toMatch(/import\(['"][^'"]*commands\/openapi\.js['"]\)/)
    expect(src).toMatch(/openapiCommand/)
  })

  it('supports --dry-run flag per EC-3 (validate without writing)', () => {
    const src = readFileSync(CLI_INDEX, 'utf-8')
    expect(src).toMatch(/--dry-run/)
  })
})

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'theokit-g2-openapi-cmd-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('T2.3 — openapiCommand (live)', () => {
  it('exits non-zero with informative error when theo.config.ts is absent (default openapi=undefined)', async () => {
    const { openapiCommand } = await import('../../packages/theo/src/cli/commands/openapi.js')
    // No theo.config.ts → defaults to openapi undefined → command must
    // tell the user to opt in by setting config.openapi.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await openapiCommand({ cwd: tmpDir })
    expect(exitSpy).toHaveBeenCalledWith(1)
    const calls = errSpy.mock.calls.flat().join('\n')
    expect(calls).toMatch(/openapi/i)
  })

  it('writes <distDir>/openapi.json when config.openapi is defined', async () => {
    // Build a minimal fixture: theo.config.ts with openapi block + empty server dir.
    mkdirSync(join(tmpDir, 'server', 'routes'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'theo.config.ts'),
      `export default {
        openapi: {
          title: 'Fixture',
          version: '0.1.0',
          servers: [{ url: 'http://localhost:9999' }],
          specVersion: '3.1.0',
          outDir: '.theokit'
        }
      }`,
    )

    const { openapiCommand } = await import('../../packages/theo/src/cli/commands/openapi.js')
    await openapiCommand({ cwd: tmpDir })

    const out = join(tmpDir, '.theokit', 'openapi.json')
    const raw = readFileSync(out, 'utf-8')
    const doc = JSON.parse(raw) as { openapi: string; info: { title: string } }
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info.title).toBe('Fixture')
  })

  it('--dry-run prints to stdout without writing (EC-3)', async () => {
    mkdirSync(join(tmpDir, 'server', 'routes'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'theo.config.ts'),
      `export default { openapi: { title: 'Dry', version: '0.0.0' } }`,
    )

    const { openapiCommand } = await import('../../packages/theo/src/cli/commands/openapi.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await openapiCommand({ cwd: tmpDir, dryRun: true })

    const { existsSync } = await import('node:fs')
    expect(existsSync(join(tmpDir, '.theokit', 'openapi.json'))).toBe(false)
    const printed = logSpy.mock.calls.flat().join('\n')
    expect(printed).toMatch(/openapi/i)
  })

  it('prints output path + migration-guide-style URL on success', async () => {
    mkdirSync(join(tmpDir, 'server', 'routes'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'theo.config.ts'),
      `export default { openapi: { title: 'P', version: '0.0.0' } }`,
    )

    const { openapiCommand } = await import('../../packages/theo/src/cli/commands/openapi.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await openapiCommand({ cwd: tmpDir })

    const printed = logSpy.mock.calls.flat().join('\n')
    expect(printed).toMatch(/openapi\.json/)
    // URL emit pattern mirrors the upgrade-readiness scanner (0.3.0 cutover plan).
    expect(printed).toMatch(/docs\/.*openapi|https?:\/\//)
  })
})
