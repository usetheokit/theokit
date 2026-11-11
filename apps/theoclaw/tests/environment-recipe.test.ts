import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { detectRecipe, parseJsonc, runRecipe } from '../src/routing/environment-recipe.js'

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

  it('parses JSONC with comments and trailing commas', () => {
    expect(parseJsonc('{ // c\n "a": "x//y", /* b */ "b": [1,],\n}')).toEqual({ a: 'x//y', b: [1] })
  })

  it('prefers the devcontainer over later recipes', async () => {
    const root = repo({
      '.devcontainer/devcontainer.json': '{"postCreateCommand":"echo hi"}',
      '.devcontainer.json': '{}',
      '.openclaw/worktree-setup.sh': 'true',
      'pnpm-lock.yaml': '',
    })
    const recipe = await detectRecipe(root)
    expect(recipe?.source).toBe('.devcontainer/devcontainer.json')
  })

  it('falls back to .devcontainer.json, setup script, then lockfile', async () => {
    expect((await detectRecipe(repo({ '.devcontainer.json': '{}' })))?.source).toBe(
      '.devcontainer.json',
    )
    expect(
      (await detectRecipe(repo({ '.openclaw/worktree-setup.sh': 'true', 'package-lock.json': '' })))
        ?.kind,
    ).toBe('setup-script')
    const lock = await detectRecipe(repo({ 'pnpm-lock.yaml': '' }))
    expect(lock?.steps[0]?.commands[0]).toEqual(['pnpm', 'install', '--frozen-lockfile'])
    expect(await detectRecipe(repo({ 'a.txt': '' }))).toBeUndefined()
  })

  it('detects each lockfile and skips the install when node_modules exists', async () => {
    const cases: [string, string[]][] = [
      ['package-lock.json', ['npm', 'ci']],
      ['yarn.lock', ['yarn', 'install', '--frozen-lockfile']],
      ['bun.lock', ['bun', 'install', '--frozen-lockfile']],
    ]
    for (const [file, command] of cases) {
      expect((await detectRecipe(repo({ [file]: '' })))?.steps[0]?.commands[0]).toEqual(command)
    }
    expect(await detectRecipe(repo({ 'pnpm-lock.yaml': '', 'node_modules/.keep': '' }))).toBeUndefined()
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
    const seen: unknown[] = []
    await runRecipe((await detectRecipe(root))!, root, async (c) => void seen.push(c))
    expect(seen).toEqual(['a', 'b', 'c', ['d', '1'], 'e'])
  })

  it('names the failing stage', async () => {
    const root = repo({ '.devcontainer.json': '{"postCreateCommand":"false"}' })
    await expect(runRecipe((await detectRecipe(root))!, root)).rejects.toThrow(
      /postCreateCommand failed/,
    )
  })
})
