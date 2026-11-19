import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { BackupError, backup } from '../../src/backup/index.js'

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
    ).rejects.toThrow(/cannot inspect excluded database/)
    await expect(
      backup({ roots: { a }, out, exclude: (_root, rel) => rel === 'db' }),
    ).rejects.toBeInstanceOf(BackupError)
  } finally {
    await chmod(join(a, 'db'), 0o600)
  }
  expect(existsSync(out)).toBe(false)
})
