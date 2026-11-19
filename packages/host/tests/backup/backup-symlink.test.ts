import { existsSync } from 'node:fs'
import { symlink } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { backup, BackupError } from '../../src/backup/index.js'
import { put, scratch } from './support.js'

it('rejects a symbolic link naming it and removes the output', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'ok.txt', '1')
  await put(base, 'secret.txt', 's')
  await symlink(join(base, 'secret.txt'), join(a, 'link'))
  const out = join(base, 'out')
  const error = await backup({ roots: { a }, out }).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(BackupError)
  expect((error as BackupError).path).toBe(join(a, 'link'))
  expect((error as BackupError).message).toContain(join(a, 'link'))
  expect(existsSync(out)).toBe(false)
})
