import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { backup, BackupError, restore } from '../../src/backup/index.js'

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
