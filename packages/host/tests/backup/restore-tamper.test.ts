import { readFile, writeFile } from 'node:fs/promises'
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
