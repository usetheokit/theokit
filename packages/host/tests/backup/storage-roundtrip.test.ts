import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createStorageRegistry, restore } from '../../src/backup/index.js'
import { makeBackup, scratch } from './storage-helpers.js'

async function tree(dir: string, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const name of (await readdir(dir)).sort((x, y) => x.localeCompare(y))) {
    const rel = `${prefix}${name}`
    if ((await stat(join(dir, name))).isDirectory()) {
      out[`${rel}/`] = ''
      Object.assign(out, await tree(join(dir, name), `${rel}/`))
    } else out[rel] = (await readFile(join(dir, name))).toString('base64')
  }
  return out
}

describe.each([true, false])('storage round trip (encrypted: %s)', (encrypted) => {
  it('stores and fetches the backup byte for byte, and restore accepts it', async () => {
    const base = await scratch()
    const backupDir = await makeBackup(base)
    const registry = createStorageRegistry({
      file: join(base, 'cfg/storage.json'),
      defaultRoot: join(base, 'stores'),
    })
    const location = await registry.init('main', { encrypted })
    expect(location).toEqual({ root: join(base, 'stores/main'), encrypted })
    const archive = await registry.store('main', backupDir)
    const handle = await open(archive, 'r')
    try {
      expect((await handle.stat()).mode & 0o777).toBe(0o600)
      if (encrypted) {
        expect((await handle.readFile()).includes(Buffer.from('hello'))).toBe(false)
      }
    } finally {
      await handle.close()
    }
    const fetched = join(base, 'fetched')
    await registry.fetchLatest('main', fetched)
    expect(await tree(fetched)).toEqual(await tree(backupDir))
    const target = join(base, 'restored')
    await restore({ from: fetched, roots: { state: target } })
    expect((await readFile(join(target, 'a.txt'))).toString()).toBe('hello')
  })

  it('lists locations, keeps the registry private and never returns the key', async () => {
    const base = await scratch()
    const file = join(base, 'storage.json')
    const registry = createStorageRegistry({ file, defaultRoot: join(base, 'stores') })
    await registry.init('one', { encrypted })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    const listed = await registry.list()
    expect(listed).toEqual([{ name: 'one', root: join(base, 'stores/one'), encrypted }])
    expect(JSON.stringify(listed)).not.toContain('key')
    await expect(registry.init('one', { encrypted })).rejects.toThrow('already exists')
    await expect(registry.init('Bad Name', { encrypted })).rejects.toThrow('must match')
  })

  it('tests a location and leaves no probe behind', async () => {
    const base = await scratch()
    const registry = createStorageRegistry({
      file: join(base, 'storage.json'),
      defaultRoot: join(base, 'stores'),
    })
    await registry.init('one', { encrypted })
    const result = await registry.test('one')
    expect(result.ok).toBe(true)
    expect(await readdir(join(base, 'stores/one'))).toEqual([])
    expect(await registry.test('nope')).toMatchObject({ ok: false })
  })
})

it('round-trips a 50 MB file', async () => {
  const base = await scratch()
  const backupDir = await makeBackup(base, 50 * 1024 * 1024)
  const registry = createStorageRegistry({
    file: join(base, 'storage.json'),
    defaultRoot: join(base, 'stores'),
  })
  await registry.init('big', { encrypted: true })
  await registry.store('big', backupDir)
  const fetched = join(base, 'fetched')
  await registry.fetchLatest('big', fetched)
  const [a, b] = await Promise.all([
    readFile(join(backupDir, 'state/big.bin')),
    readFile(join(fetched, 'state/big.bin')),
  ])
  expect(a.equals(b)).toBe(true)
}, 60_000)
