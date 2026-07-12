import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Regression guard for the ESM `__dirname` bug (create-theokit 1.1.0–1.2.0). Every OTHER test imports the
 * SOURCE (`scaffold`, `applySurface`) and runs it under vitest, where `__dirname` is a provided global — so
 * a bare `__dirname` in `scaffold-surface.ts` passed every unit test yet crashed the PUBLISHED ESM bundle
 * with `__dirname is not defined` the moment a user ran `npx create-theokit --surface tui` for real.
 *
 * This suite runs the BUILT bundle (`dist/cli.js`) exactly as a user would, catching that whole class of
 * "works from source, broken when bundled" bug. It skips (not fails) when the bundle hasn't been built.
 */
const CLI = resolve(fileURLToPath(new URL('../../dist/cli.js', import.meta.url)))
const hasBundle = existsSync(CLI)

describe.skipIf(!hasBundle)('built CLI (dist/cli.js) — runs as a published binary', () => {
  let workDir: string

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ctk-built-cli-'))
  })
  afterAll(() => {
    if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true })
  })

  /**
   * Run the built CLI in an isolated dir; throws on non-zero exit — that IS the assertion. `--skip-install`
   * keeps it fast + deterministic: the `__dirname` crash we guard against happens during SCAFFOLD, before any
   * package install, so we don't pay for (or flake on) a real `npm install` here.
   */
  function runCli(name: string, ...args: string[]): void {
    execFileSync(process.execPath, [CLI, name, '--yes', '--skip-install', ...args], {
      cwd: workDir,
      stdio: 'pipe',
      encoding: 'utf-8',
    })
  }

  it('scaffolds a --surface=tui app without a __dirname crash', () => {
    expect(() => runCli('tui-app', '--surface=tui')).not.toThrow()
    const dir = join(workDir, 'tui-app')
    expect(existsSync(join(dir, 'tui/App.tsx'))).toBe(true)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['@theokit/tui']).toBeDefined()
  })

  it('scaffolds a --surface=desktop app without a __dirname crash', () => {
    expect(() => runCli('desk-app', '--surface=desktop')).not.toThrow()
    const dir = join(workDir, 'desk-app')
    expect(existsSync(join(dir, 'frontend/src/App.tsx'))).toBe(true)
    expect(existsSync(join(dir, 'sidecar/sidecar.ts'))).toBe(true)
  })
})
