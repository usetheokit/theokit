import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AUTHORED_AGENT_CONTEXT,
  cleanBuildOutput,
} from '../../packages/theo/src/cli/cleanup/cleanup.js'

/**
 * #1079 — `theokit build` emptied `.theokit/` except `.git*`, and `.theokit/` is also where the
 * scaffold writes THEO.md, rules and personalities. The first build of a fresh scaffold deleted
 * all three, and the scaffold's `.gitignore` meant git had no copy (#1075).
 */
describe('cleanBuildOutput', () => {
  let project: string
  let origCwd: string

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'theokit-build-clean-'))
    origCwd = process.cwd()
    process.chdir(project)
  })

  afterEach(() => {
    process.chdir(origCwd)
    rmSync(project, { recursive: true, force: true })
  })

  function write(path: string): void {
    const full = join(project, '.theokit', path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, 'x')
  }

  it('keeps the agent context and runtime state a person or the agent wrote', async () => {
    const kept = [
      'THEO.md',
      'THEO.local.md',
      'rules/server-routes.md',
      'personalities/concise.md',
      'skills/review/SKILL.md',
      'agents/helper.md',
      'commands/ship.md',
      'hooks.json',
      'memory/MEMORY.md',
      'mcp-tokens.json',
    ]
    kept.forEach(write)

    await cleanBuildOutput(join(project, '.theokit'))

    for (const path of kept) expect(existsSync(join(project, '.theokit', path)), path).toBe(true)
  })

  it('removes what an earlier build wrote', async () => {
    const generated = [
      'manifest.json',
      'client/index.html',
      'agents.d.ts',
      'server/entry.js',
      'bun/server.mjs',
    ]
    generated.forEach(write)

    await cleanBuildOutput(join(project, '.theokit'))

    for (const path of generated)
      expect(existsSync(join(project, '.theokit', path)), path).toBe(false)
  })
})

// create-theokit cannot import from theokit, so its `.gitignore` repeats the list by hand (#1075).
describe('the scaffold .gitignore', () => {
  it('versions every authored context entry the build keeps', () => {
    const gitignore = readFileSync(
      resolve(__dirname, '../../packages/create-theokit/templates/default/_gitignore'),
      'utf-8',
    ).split('\n')
    for (const entry of AUTHORED_AGENT_CONTEXT) {
      const negations = new Set([`!.theokit/${entry}`, `!.theokit/${entry}/`])
      expect(
        gitignore.some((line) => negations.has(line)),
        `${entry} is not un-ignored`,
      ).toBe(true)
    }
  })
})
