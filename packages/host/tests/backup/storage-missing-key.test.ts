import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { BackupError, createStorageRegistry } from '../../src/backup/index.js'
import { makeBackup, scratch } from './storage-helpers.js'

it('rejects store and fetchLatest when an encrypted entry has no key', async () => {
  const base = await scratch()
  const backupDir = await makeBackup(base)
  const file = join(base, 'storage.json')
  const registry = createStorageRegistry({ file, defaultRoot: join(base, 'stores') })
  await registry.init('a', { encrypted: true })
  await registry.store('a', backupDir)
  const parsed = JSON.parse(await readFile(file, 'utf8')) as {
    locations: Record<string, { key?: string }>
  }
  delete parsed.locations['a'].key
  await writeFile(file, JSON.stringify(parsed))

  const root = join(base, 'stores/a')
  const before = await readdir(root)
  await expect(registry.store('a', backupDir)).rejects.toBeInstanceOf(BackupError)
  await expect(registry.fetchLatest('a', join(base, 'out'))).rejects.toBeInstanceOf(BackupError)
  expect(await readdir(root)).toEqual(before)
  expect(await readdir(base)).not.toContain('out')
  expect(await registry.test('a')).toMatchObject({ ok: false })
})
