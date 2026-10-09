import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generate } from '../../packages/theo/src/cli/commands/generate.js'

/**
 * The schedule `theokit generate schedule` writes typechecks under the scaffold's strict
 * `tsconfig.json`, next to the scaffold's own `chat.ts`.
 *
 * Every other schedule test loads the generated file through tsx, which strips types, so a template
 * edit or an SDK type change could break every user's `tsc` on a freshly generated file with the
 * suite green (review F-tests-3). The template narrows `chat` to read `model` and `plugins`, and
 * passes it to `streamAgentTurnInProcess`; this runs the compiler over exactly that.
 *
 * Scoped to the generated file (which imports `chat.ts` and its neighbours) rather than the whole
 * app, and every package resolves to the one copy `@theokit/agents` uses. Two `zod` copies in one
 * type graph exhaust tsc's heap (measured in the Demonstration, 2026-10-09), which says nothing
 * about the template.
 *
 * Reads `packages/theo/dist` and `packages/agents/dist` declarations: build both first.
 */
const REPO = resolve(__dirname, '../..')
const TEMPLATE = resolve(REPO, 'packages/create-theokit/templates/default')
// The compiler by absolute path, never through PATH (sonarjs/no-os-command-from-path).
const TSC = join(REPO, 'node_modules', '.bin', 'tsc')
const agentsRequire = createRequire(resolve(REPO, 'packages/agents/package.json'))
const repoRequire = createRequire(resolve(REPO, 'package.json'))

function packageDir(require: NodeJS.Require, name: string): string {
  return dirname(require.resolve(`${name}/package.json`))
}

let dir: string

describe('a generated schedule typechecks beside the scaffold chat agent', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'theo-schedule-tsc-'))
    copyFileSync(join(TEMPLATE, 'theo.config.ts'), join(dir, 'theo.config.ts'))
    copyFileSync(join(TEMPLATE, 'tsconfig.json'), join(dir, 'tsconfig.json'))
    writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')
    cpSync(join(TEMPLATE, 'src/server/agents'), join(dir, 'src/server/agents'), { recursive: true })
    const modules = join(dir, 'node_modules')
    mkdirSync(join(modules, '@theokit'), { recursive: true })
    mkdirSync(join(modules, '@types'), { recursive: true })
    symlinkSync(resolve(REPO, 'packages/theo'), join(modules, 'theokit'), 'dir')
    symlinkSync(resolve(REPO, 'packages/agents'), join(modules, '@theokit/agents'), 'dir')
    symlinkSync(packageDir(agentsRequire, 'zod'), join(modules, 'zod'), 'dir')
    symlinkSync(packageDir(agentsRequire, '@theokit/sdk'), join(modules, '@theokit/sdk'), 'dir')
    symlinkSync(packageDir(repoRequire, '@types/node'), join(modules, '@types/node'), 'dir')
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('test_a_generated_schedule_typechecks_beside_the_scaffold_chat_agent', async () => {
    const result = await generate({ cwd: dir, type: 'schedule', name: 'daily-digest' })
    expect(result.status).toBe('created')
    writeFileSync(
      join(dir, 'tsconfig.schedule.json'),
      JSON.stringify({
        extends: './tsconfig.json',
        include: ['src/server/agents/schedules/daily-digest.ts'],
      }),
    )

    let output = ''
    let exitCode = 0
    try {
      execFileSync(TSC, ['--noEmit', '-p', 'tsconfig.schedule.json'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
      })
    } catch (err) {
      const failed = err as { status?: number; stdout?: string; stderr?: string }
      exitCode = failed.status ?? 1
      output = `${failed.stdout ?? ''}${failed.stderr ?? ''}`
    }

    expect(output).toBe('')
    expect(exitCode).toBe(0)
  }, 180_000)
})
