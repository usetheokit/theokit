import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generate, generateCommand } from '../../packages/theo/src/cli/commands/generate.js'

/**
 * `theokit generate controller` tells the user which packages a controller build needs that the
 * project does not declare. It used to ask Node whether `@theokit/http` resolved, and in an
 * npm-installed scaffold it always does: `theokit` and `@theokit/agents` depend on it, so npm
 * hoists it into the app's `node_modules`. The notice never fired, and `theokit build` then failed
 * on the missing `@swc/core`, which the notice did not name even when it did fire.
 *
 * Each project here sits under a directory whose `node_modules` holds `@theokit/http`, the layout
 * that hid the gap.
 */
let root: string
let app: string

function writeProject(packageJson: Record<string, unknown>, lockfile?: string): void {
  writeFileSync(join(app, 'package.json'), JSON.stringify(packageJson))
  if (lockfile !== undefined) writeFileSync(join(app, lockfile), '')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-controller-notice-'))
  mkdirSync(join(root, 'node_modules/@theokit/http'), { recursive: true })
  writeFileSync(
    join(root, 'node_modules/@theokit/http/package.json'),
    '{ "name": "@theokit/http" }',
  )
  app = join(root, 'app')
  mkdirSync(app)
  writeFileSync(join(app, 'theo.config.ts'), 'export default {}')
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('the controller notice', () => {
  it('names every package the build needs when package.json declares none, though @theokit/http resolves', async () => {
    writeProject({ dependencies: { theokit: '^0.76.0' } }, 'package-lock.json')

    const result = await generate({ cwd: app, type: 'controller', name: 'users' })

    expect(result.status).toBe('created')
    expect(result.message).toContain('npm install @theokit/http reflect-metadata')
    expect(result.message).toContain('npm install -D @swc/core')
  })

  it('names only the packages package.json does not declare', async () => {
    writeProject(
      {
        dependencies: {
          theokit: '^0.76.0',
          '@theokit/http': '^2.3.0',
          'reflect-metadata': '^0.2.2',
        },
      },
      'package-lock.json',
    )

    const result = await generate({ cwd: app, type: 'controller', name: 'users' })

    expect(result.message).toContain('npm install -D @swc/core')
    expect(result.message).not.toContain('@theokit/http reflect-metadata')
  })

  it('says nothing when package.json declares every package, in dependencies or devDependencies', async () => {
    writeProject({
      dependencies: { '@theokit/http': '^2.3.0', 'reflect-metadata': '^0.2.2' },
      devDependencies: { '@swc/core': '^1.15.0' },
    })

    const result = await generate({ cwd: app, type: 'controller', name: 'users' })

    expect(result.status).toBe('created')
    expect(result.message).toBeUndefined()
  })

  it("uses the project's package manager, read from its lockfile", async () => {
    writeProject({}, 'pnpm-lock.yaml')

    const result = await generate({ cwd: app, type: 'controller', name: 'users' })

    expect(result.message).toContain('pnpm add @theokit/http reflect-metadata')
    expect(result.message).toContain('pnpm add -D @swc/core')
  })

  it('is printed by the CLI', async () => {
    writeProject({}, 'package-lock.json')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(app)

    await generateCommand('controller', 'users')

    cwd.mockRestore()
    const printed = log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toContain('npm install -D @swc/core')
  })
})
