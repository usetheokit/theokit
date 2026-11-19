import { readFile, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { backup } from '../../src/backup/index.js'
import { restoreWith } from '../../src/backup/restore.js'
import { put, scratch } from './support.js'

it('puts the first target back when the second root fails to place', async () => {
  const base = await scratch()
  await put(join(base, 'a'), 'f', 'new-a')
  await put(join(base, 'b'), 'f', 'new-b')
  const out = join(base, 'out')
  await backup({ roots: { a: join(base, 'a'), b: join(base, 'b') }, out })
  const ta = join(base, 'ta')
  const tb = join(base, 'tb')
  await put(ta, 'old', 'old-a')
  await put(tb, 'old', 'old-b')

  // Placing a root is two renames (target aside, stage into place): fail the fourth call.
  let calls = 0
  const failing = async (from: string, to: string): Promise<void> => {
    calls += 1
    if (calls === 4) throw new Error('injected rename failure')
    await rename(from, to)
  }
  await expect(
    restoreWith({ from: out, roots: { a: ta, b: tb } }, { rename: failing }),
  ).rejects.toThrow('injected')
  expect(await readFile(join(ta, 'old'), 'utf8')).toBe('old-a')
  expect(await readFile(join(tb, 'old'), 'utf8')).toBe('old-b')
  expect((await readdir(base)).toSorted((x, y) => x.localeCompare(y))).toEqual([
    'a',
    'b',
    'out',
    'ta',
    'tb',
  ])
})
