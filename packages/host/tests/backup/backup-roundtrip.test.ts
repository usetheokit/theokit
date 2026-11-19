import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { backup, restore } from '../../src/backup/index.js'
import { put, scratch } from './support.js'

it('backs up two roots and restores them byte for byte', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  const b = join(base, 'b')
  await put(a, 'x.txt', 'hello')
  await put(a, 'deep/er/y.bin', Buffer.from([0, 1, 2, 255]))
  await put(b, 'z.txt', 'zed')
  const out = join(base, 'out')
  const copied: string[] = []
  const manifest = await backup({
    roots: { alpha: a, beta: b },
    out,
    onFileCopied: (p) => copied.push(p),
  })
  expect(manifest.roots).toEqual(['alpha', 'beta'])
  expect(manifest.files.map((f) => f.path).toSorted((x, y) => x.localeCompare(y))).toEqual([
    'alpha/deep/er/y.bin',
    'alpha/x.txt',
    'beta/z.txt',
  ])
  expect(copied.toSorted((x, y) => x.localeCompare(y))).toEqual(
    manifest.files.map((f) => f.path).toSorted((x, y) => x.localeCompare(y)),
  )

  const ta = join(base, 'ta')
  const tb = join(base, 'tb')
  await restore({ from: out, roots: { alpha: ta, beta: tb } })
  expect(await readFile(join(ta, 'x.txt'), 'utf8')).toBe('hello')
  expect([...(await readFile(join(ta, 'deep/er/y.bin')))]).toEqual([0, 1, 2, 255])
  expect(await readFile(join(tb, 'z.txt'), 'utf8')).toBe('zed')
  if (process.platform !== 'win32') {
    expect((await stat(join(out, 'alpha/x.txt'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(out, 'alpha/deep'))).mode & 0o777).toBe(0o700)
    expect((await stat(out)).mode & 0o777).toBe(0o700)
    expect((await stat(join(ta, 'deep/er/y.bin'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(ta, 'deep'))).mode & 0o777).toBe(0o700)
  }
})

it('refuses a non-empty output', async () => {
  const base = await scratch()
  await put(join(base, 'a'), 'x', '1')
  await put(join(base, 'out'), 'old', '1')
  await expect(backup({ roots: { a: join(base, 'a') }, out: join(base, 'out') })).rejects.toThrow(
    /not empty/,
  )
})
