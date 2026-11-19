import { existsSync } from 'node:fs'
import { chmod } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { BackupError, backup } from '../../src/backup/index.js'
import { put, scratch } from './support.js'

it('leaves an excluded path out of the manifest and the output', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'keep.txt', '1')
  await put(a, 'import/token.txt', 'secret')
  const out = join(base, 'out')
  const manifest = await backup({
    roots: { a },
    out,
    exclude: (root, rel) => root === 'a' && rel === 'import',
  })
  expect(manifest.files.map((f) => f.path)).toEqual(['a/keep.txt'])
  expect(existsSync(join(out, 'a/import'))).toBe(false)
})

it('fails when an excluded database cannot be opened for its header check', async () => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'db', 'x')
  await put(a, 'db-wal', 'wal')
  await chmod(join(a, 'db'), 0o000)
  const out = join(base, 'out')
  try {
    await expect(
      backup({ roots: { a }, out, exclude: (_root, rel) => rel === 'db' }),
    ).rejects.toBeInstanceOf(BackupError)
  } finally {
    await chmod(join(a, 'db'), 0o600)
  }
  expect(existsSync(out)).toBe(false)
})
