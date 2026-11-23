import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { prepareEnvironment } from '../src/routing/environment-recipe.js'

describe('environment recipes', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
  const repo = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'er-'))
    dirs.push(root)
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(root, name, '..'), { recursive: true })
      writeFileSync(join(root, name), text)
    }
    return root
  }

  const seen = async (root: string) => {
    const commands: unknown[] = []
    const recipe = await prepareEnvironment(root, async (c) => void commands.push(c))
    return { recipe, commands }
  }

  it('prefers the devcontainer over later recipes', async () => {
    const root = repo({
      '.devcontainer/devcontainer.json': '{"postCreateCommand":"echo hi"}',
      '.devcontainer.json': '{}',
      '.openclaw/worktree-setup.sh': 'true',
      'pnpm-lock.yaml': '',
    })
    const { recipe, commands } = await seen(root)
    expect(recipe?.source).toBe('.devcontainer/devcontainer.json')
    expect(commands).toEqual(['echo hi'])
  })

  it('falls back to .devcontainer.json, setup script, then lockfile', async () => {
    expect((await seen(repo({ '.devcontainer.json': '{}' }))).recipe?.source).toBe('.devcontainer.json')
    const script = await seen(repo({ '.theoclaw/worktree-setup.sh': 'true', 'package-lock.json': '' }))
    expect(script.recipe?.kind).toBe('setup-script')
    expect(script.commands).toEqual([['sh', '.theoclaw/worktree-setup.sh']])
    expect((await seen(repo({ 'pnpm-lock.yaml': '' }))).commands).toEqual([['pnpm', 'install', '--frozen-lockfile']])
    expect((await seen(repo({ 'a.txt': '' }))).recipe).toBeUndefined()
  })

  it('parses JSONC with comments and trailing commas', async () => {
    const root = repo({
      '.devcontainer.json': '{ // c\n "postCreateCommand": "a//b", /* x */ "postStartCommand": ["c", "d",],\n}',
    })
    expect((await seen(root)).commands).toEqual(['a//b', ['c', 'd']])
  })

  it('detects each lockfile and skips the install when node_modules exists', async () => {
    const cases: [string, string[]][] = [
      ['package-lock.json', ['npm', 'ci']],
      ['yarn.lock', ['yarn', 'install', '--frozen-lockfile']],
      ['bun.lock', ['bun', 'install', '--frozen-lockfile']],
    ]
    for (const [file, command] of cases) {
      expect((await seen(repo({ [file]: '' }))).commands).toEqual([command])
    }
    expect((await seen(repo({ 'pnpm-lock.yaml': '', 'node_modules/.keep': '' }))).recipe).toBeUndefined()
  })

  it('runs lifecycle stages in order, flattening objects and arrays', async () => {
    const root = repo({
      '.devcontainer/devcontainer.json': JSON.stringify({
        postStartCommand: 'e',
        postCreateCommand: { x: 'c', y: ['d', '1'] },
        onCreateCommand: 'a',
        updateContentCommand: 'b',
      }),
    })
    expect((await seen(root)).commands).toEqual(['a', 'b', 'c', ['d', '1'], 'e'])
  })

  it('names the failing stage', async () => {
    const root = repo({ '.devcontainer.json': '{"postCreateCommand":"false"}' })
    await expect(prepareEnvironment(root)).rejects.toThrow(/postCreateCommand failed/)
  })
})
