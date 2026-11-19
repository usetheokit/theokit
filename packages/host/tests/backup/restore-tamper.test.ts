import { readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { backup, BackupError, restore } from '../../src/backup/index.js'
import { put, scratch } from './support.js'

async function setup() {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'x.txt', 'original')
  const out = join(base, 'out')
  await backup({ roots: { a }, out })
  const target = join(base, 'target')
  await put(target, 'mine.txt', 'keep me')
  return { out, target }
}

it('rejects a file whose bytes differ and changes no target', async () => {
  const { out, target } = await setup()
  await writeFile(join(out, 'a/x.txt'), 'tampered')
  await expect(restore({ from: out, roots: { a: target } })).rejects.toBeInstanceOf(BackupError)
  expect(await readFile(join(target, 'mine.txt'), 'utf8')).toBe('keep me')
  expect(existsSync(join(target, 'x.txt'))).toBe(false)
})

it('refuses a manifest path that leaves its root', async () => {
  const { out, target } = await setup()
  const file = join(out, 'manifest.json')
  const manifest = JSON.parse(await readFile(file, 'utf8')) as { files: { path: string }[] }
  manifest.files[0]!.path = '../x'
  await writeFile(file, JSON.stringify(manifest))
  await expect(restore({ from: out, roots: { a: target } })).rejects.toThrow(/not a file inside/)
  expect(await readFile(join(target, 'mine.txt'), 'utf8')).toBe('keep me')
})

it('refuses a symbolic link in an intermediate directory of the backup', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'deep/x.txt', 'original')
  const out = join(base, 'out')
  await backup({ roots: { a }, out })
  await put(base, 'outside/x.txt', 'original')
  await rm(join(out, 'a/deep'), { recursive: true })
  await symlink(join(base, 'outside'), join(out, 'a/deep'))
  const target = join(base, 'target')
  await expect(restore({ from: out, roots: { a: target } })).rejects.toThrow(/symbolic link/)
  expect(existsSync(target)).toBe(false)
})
