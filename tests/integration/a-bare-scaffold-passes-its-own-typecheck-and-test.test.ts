import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { scaffold } from '../../packages/create-theokit/src/index.js'

/**
 * `create-theokit --bare` removed `@theokit/agents`, `@theokit/sdk` and `@theokit/ui` from
 * `package.json` but left `src/server/agents/{hooks,skills}` and the chat page test importing them,
 * so the first `typecheck` exited 2 and `test` exited 1 (usetheokit/theokit#1008).
 *
 * This runs the scaffold's own two scripts, `tsc --noEmit` and `vitest run`, against the bare
 * output. Dependencies are the workspace copies the bare app keeps, linked into its
 * `node_modules`; a package the bare app no longer declares is NOT linked, so an import of one
 * fails here exactly as it does after `npm install`.
 *
 * Reads `packages/theo/dist` declarations: build it first.
 */
const REPO = resolve(__dirname, '../..')
const TSC = join(REPO, 'node_modules', '.bin', 'tsc')
const VITEST = join(REPO, 'node_modules', '.bin', 'vitest')
const repoRequire = createRequire(resolve(REPO, 'package.json'))

const KEPT_PACKAGES = [
  'react',
  'react-dom',
  'react-router',
  'zod',
  'vitest',
  '@types/node',
  '@types/react',
  '@types/react-dom',
]

let root: string
let app: string

function run(bin: string, args: string[]): { exitCode: number; output: string } {
  try {
    const output = execFileSync(bin, args, { cwd: app, encoding: 'utf8', stdio: 'pipe' })
    return { exitCode: 0, output }
  } catch (err) {
    const failed = err as { status?: number; stdout?: string; stderr?: string }
    return { exitCode: failed.status ?? 1, output: `${failed.stdout ?? ''}${failed.stderr ?? ''}` }
  }
}

describe('a --bare scaffold passes the scripts it ships with', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'theo-bare-scripts-'))
    app = join(root, 'bare')
    scaffold(app, 'bare', 'default', { bare: true })
    const modules = join(app, 'node_modules')
    mkdirSync(join(modules, '@types'), { recursive: true })
    symlinkSync(resolve(REPO, 'packages/theo'), join(modules, 'theokit'), 'dir')
    for (const name of KEPT_PACKAGES) {
      const target = join(modules, name)
      mkdirSync(dirname(target), { recursive: true })
      symlinkSync(dirname(repoRequire.resolve(`${name}/package.json`)), target, 'dir')
    }
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('removes the agent code whose dependencies it removed', () => {
    expect(existsSync(join(app, 'src/server/agents'))).toBe(false)
  })

  it('typecheck exits 0', () => {
    const result = run(TSC, ['--noEmit', '-p', 'tsconfig.json'])
    expect(result.output).toBe('')
    expect(result.exitCode).toBe(0)
  }, 180_000)

  it('test exits 0 and runs at least one test', () => {
    const result = run(VITEST, ['run', '--root', app, '--reporter', 'dot'])
    expect(result.output).not.toMatch(/No test files found/)
    expect(result.exitCode, result.output).toBe(0)
  }, 180_000)
})
