import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { BackupError, createStorageRegistry } from '../../src/backup/index.js'
import { makeBackup, scratch } from './storage-helpers.js'

async function setup() {
  const base = await scratch()
  const backupDir = await makeBackup(base)
  const registry = createStorageRegistry({
    file: join(base, 'storage.json'),
    defaultRoot: join(base, 'stores'),
  })
  await registry.init('a', { encrypted: true })
  await registry.init('b', { encrypted: true })
  return { base, backupDir, registry }
}

it('refuses an archive sealed with another location key and writes nothing', async () => {
  const { base, backupDir, registry } = await setup()
  const archive = await registry.store('a', backupDir)
  await registry.store('b', backupDir) // gives b its own root to put a's archive in
  const [stolen] = await readdir(join(base, 'stores/b'))
  await writeFile(join(base, 'stores/b', stolen), await readFile(archive))
  const into = join(base, 'out')
  await expect(registry.fetchLatest('b', into)).rejects.toBeInstanceOf(BackupError)
  expect(await readdir(base)).not.toContain('out')
  expect((await readdir(base)).filter((n) => n.includes('fetch'))).toEqual([])
})

it('refuses an archive with one flipped byte', async () => {
  const { base, backupDir, registry } = await setup()
  const archive = await registry.store('a', backupDir)
  const bytes = await readFile(archive)
  for (const at of [3, 7, 20, bytes.length - 1]) {
    const copy = Buffer.from(bytes)
    copy[at] ^= 1
    await writeFile(archive, copy)
    const into = join(base, `out-${at}`)
    await expect(registry.fetchLatest('a', into)).rejects.toBeInstanceOf(BackupError)
  }
  expect((await readdir(base)).filter((n) => n.startsWith('out'))).toEqual([])
  expect((await readdir(base)).filter((n) => n.includes('fetch'))).toEqual([])
})

it('refuses a foreign file', async () => {
  const { base, backupDir, registry } = await setup()
  const archive = await registry.store('a', backupDir)
  await writeFile(archive, 'not an archive at all, just text')
  await expect(registry.fetchLatest('a', join(base, 'x'))).rejects.toBeInstanceOf(BackupError)
})
