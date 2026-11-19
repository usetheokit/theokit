import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { backup } from '../../src/backup/index.js'
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
