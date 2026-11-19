import { join } from 'node:path'

import { expect, it } from 'vitest'

import { backup, BackupError } from '../../src/backup/index.js'
import { put, scratch } from './support.js'

it('refuses an output equal to or inside a root, and nested roots', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'x', '1')
  await expect(backup({ roots: { a }, out: a })).rejects.toBeInstanceOf(BackupError)
  await expect(backup({ roots: { a }, out: join(a, 'out') })).rejects.toBeInstanceOf(BackupError)
  await expect(
    backup({ roots: { a, b: join(a, 'sub') }, out: join(base, 'out') }),
  ).rejects.toBeInstanceOf(BackupError)
})

it('accepts siblings that share a name prefix', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'x', '1')
  const manifest = await backup({ roots: { a }, out: join(base, 'a-backup') })
  expect(manifest.files).toHaveLength(1)
})

it('refuses invalid root names and relative directories', async () => {
  const base = await scratch()
  await expect(backup({ roots: { Bad_Name: base }, out: join(base, 'o') })).rejects.toBeInstanceOf(
    BackupError,
  )
  await expect(backup({ roots: { a: 'rel' }, out: join(base, 'o') })).rejects.toBeInstanceOf(
    BackupError,
  )
})
