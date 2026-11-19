import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { backup, BackupError } from '../../src/backup/index.js'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function scratch(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'host-backup-'))
  dirs.push(d)
  return d
}

async function put(root: string, rel: string, data: string | Buffer): Promise<void> {
  const file = join(root, rel)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, data)
}

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

it('rejects a root that is itself a symbolic link', async () => {
  const base = await scratch()
  const real = join(base, 'real')
  await put(real, 'x.txt', '1')
  const a = join(base, 'a')
  await symlink(real, a)
  const out = join(base, 'out')
  const error = await backup({ roots: { a }, out }).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(BackupError)
  expect((error as BackupError).path).toBe(a)
  expect(existsSync(out)).toBe(false)
})
