import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'vitest'

import { backup } from '../../src/backup/index.js'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

export async function scratch(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'host-storage-'))
  dirs.push(d)
  return d
}

/** A verified backup directory with a few files, an empty directory and `extra` bytes of bulk. */
export async function makeBackup(base: string, bulk = 0): Promise<string> {
  const src = join(base, 'src')
  await mkdir(join(src, 'deep/er'), { recursive: true })
  await mkdir(join(src, 'empty'), { recursive: true })
  await writeFile(join(src, 'a.txt'), 'hello')
  await writeFile(join(src, 'deep/er/b.bin'), Buffer.from([0, 1, 2, 255]))
  if (bulk > 0) await writeFile(join(src, 'big.bin'), Buffer.alloc(bulk, 7))
  const out = join(base, 'backup')
  await backup({ roots: { state: src }, out })
  return out
}
