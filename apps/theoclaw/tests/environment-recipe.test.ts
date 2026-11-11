import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { detectRecipe, parseJsonc } from '../src/routing/environment-recipe.js'

function dir(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), 'rcp-'))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(d, name, '..'), { recursive: true })
    writeFileSync(join(d, name), text)
  }
  return d
}

describe('environment recipe', () => {
  it('parses JSONC', () => {
    expect(parseJsonc('{ /* a */ "u": "http://x", // c\n "a": [1,], }')).toEqual({ u: 'http://x', a: [1] })
  })

  it('orders lifecycle steps and accepts string, array and object commands', async () => {
    const d = dir({
      '.devcontainer.json': JSON.stringify({
        postStartCommand: 'c',
        onCreateCommand: ['echo', 'a'],
        postCreateCommand: { x: 'b', y: 'd' },
      }),
    })
    try {
      const r = await detectRecipe(d)
      expect(r?.kind).toBe('devcontainer')
      expect(r?.steps.map((s) => s.stage)).toEqual(['onCreateCommand', 'postCreateCommand:x', 'postCreateCommand:y', 'postStartCommand'])
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('prefers devcontainer, then setup script, then lockfile', async () => {
    const all = dir({ '.devcontainer/devcontainer.json': '{}', '.openclaw/worktree-setup.sh': 'true', 'pnpm-lock.yaml': '' })
    const noDev = dir({ '.openclaw/worktree-setup.sh': 'true', 'pnpm-lock.yaml': '' })
    const lock = dir({ 'package-lock.json': '' })
    const none = dir({ 'a.txt': '' })
    try {
      expect((await detectRecipe(all))?.kind).toBe('devcontainer')
      expect((await detectRecipe(noDev))?.kind).toBe('setup-script')
      expect((await detectRecipe(lock))?.steps[0]?.argv).toEqual(['npm', 'ci'])
      expect(await detectRecipe(none)).toBeUndefined()
    } finally {
      for (const d of [all, noDev, lock, none]) rmSync(d, { recursive: true, force: true })
    }
  })
})
