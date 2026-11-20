import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  detectWorkspaceRecipe,
  prepareWorkspace,
  WorkspaceRecipeError,
  type RecipeExec,
} from './prepare-workspace.js'

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'pw-'))
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
  }
  return root
}

describe('prepareWorkspace', () => {
  it('a devcontainer wins over a setup script and a lockfile', async () => {
    const root = dir({
      '.devcontainer/devcontainer.json': '{"postCreateCommand":"echo hi"}',
      'setup.sh': 'true',
      'pnpm-lock.yaml': '',
    })
    const recipe = await detectWorkspaceRecipe(root, { setupScripts: ['setup.sh'] })
    expect(recipe?.kind).toBe('devcontainer')
    expect(recipe?.source).toBe('.devcontainer/devcontainer.json')
  })

  it('a setup script wins over a lockfile, and none is assumed by default', async () => {
    const root = dir({ 'setup.sh': 'true', 'package-lock.json': '' })
    expect((await detectWorkspaceRecipe(root, { setupScripts: ['setup.sh'] }))?.kind).toBe(
      'setup-script',
    )
    expect((await detectWorkspaceRecipe(root))?.kind).toBe('lockfile')
  })

  it('a devcontainer with comments and trailing commas is parsed', async () => {
    const root = dir({
      '.devcontainer.json': `{
  // a comment
  "name": "x // not a comment",
  /* block */
  "postCreateCommand": "npm ci", 
  "postStartCommand": ["echo", "a,}"],
}`,
    })
    const recipe = await detectWorkspaceRecipe(root)
    expect(recipe?.steps).toEqual([
      { stage: 'postCreateCommand', commands: ['npm ci'] },
      { stage: 'postStartCommand', commands: [['echo', 'a,}']] },
    ])
  })

  it('an object lifecycle value runs its commands in parallel and the next stage waits', async () => {
    const root = dir({
      '.devcontainer.json': JSON.stringify({
        onCreateCommand: { a: 'one', b: 'two' },
        postCreateCommand: 'three',
      }),
    })
    const log: string[] = []
    const exec: RecipeExec = async (command) => {
      log.push(`start ${String(command)}`)
      await new Promise((r) => setTimeout(r, 20))
      log.push(`end ${String(command)}`)
    }
    await prepareWorkspace(root, { exec })
    expect(log.slice(0, 2)).toEqual(['start one', 'start two'])
    expect(log.slice(2, 4).sort((a, b) => a.localeCompare(b))).toEqual(['end one', 'end two'])
    expect(log.slice(4)).toEqual(['start three', 'end three'])
  })

  it('a lockfile recipe is skipped when node_modules exists', async () => {
    const root = dir({ 'pnpm-lock.yaml': '', 'node_modules/.keep': '' })
    const calls: unknown[] = []
    expect(
      await prepareWorkspace(root, {
        exec: async (c) => {
          calls.push(c)
        },
      }),
    ).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('a failing command throws WorkspaceRecipeError naming source and stage, with the original as cause', async () => {
    const root = dir({ '.devcontainer.json': '{"postCreateCommand":"boom"}' })
    const original = new Error('exit 1')
    const error = await prepareWorkspace(root, {
      exec: () => Promise.reject(original),
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WorkspaceRecipeError)
    const typed = error as WorkspaceRecipeError
    expect(typed.source).toBe('.devcontainer.json')
    expect(typed.stage).toBe('postCreateCommand')
    expect(typed.cause).toBe(original)
  })

  it('a command over timeoutMs fails the recipe', async () => {
    const root = dir({ '.devcontainer.json': '{"postCreateCommand":"slow"}' })
    await expect(
      prepareWorkspace(root, { exec: () => new Promise(() => {}), timeoutMs: 20 }),
    ).rejects.toThrow(/timed out/)
  })

  it('a timed-out command is aborted through the signal given to exec', async () => {
    const root = dir({ '.devcontainer.json': '{"postCreateCommand":"x"}' })
    let aborted = false
    await expect(
      prepareWorkspace(root, {
        exec: (_c, _cwd, signal) =>
          new Promise(() => {
            signal?.addEventListener('abort', () => {
              aborted = true
            })
          }),
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(WorkspaceRecipeError)
    expect(aborted).toBe(true)
  })

  it.each(['[]', '[1]', '5', '{"a":[]}'])(
    'a malformed lifecycle value %s is a parse error, not dropped',
    async (value) => {
      const root = dir({ '.devcontainer.json': `{"postCreateCommand":${value}}` })
      await expect(detectWorkspaceRecipe(root)).rejects.toMatchObject({
        stage: 'parse',
        source: '.devcontainer.json',
      })
    },
  )

  it('the default executor runs a setup script', async () => {
    const root = dir({ 'setup.sh': 'echo ok > done.txt' })
    await prepareWorkspace(root, { setupScripts: ['setup.sh'] })
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(join(root, 'done.txt'), 'utf8').trim()).toBe('ok')
  })
})
