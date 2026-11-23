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

describe.each([true, false])(
  'archives and registries of the earlier TheoClaw (encrypted: %s)',
  (encrypted) => {
    async function legacy(base: string, name: string) {
      const { createCipheriv, createHash, randomBytes } = await import('node:crypto')
      const { mkdir, writeFile } = await import('node:fs/promises')
      const root = join(base, 'old')
      await mkdir(root)
      const key = randomBytes(32)
      const data = 'legacy-bytes'
      const manifest = {
        version: 1,
        files: [
          {
            path: 'state/a.txt',
            sha256: createHash('sha256').update(data).digest('hex'),
            size: data.length,
          },
        ],
      }
      const files = [
        { path: 'state/a.txt', data: Buffer.from(data).toString('base64') },
        { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)).toString('base64') },
      ]
      const write = async (file: string, payload: unknown, tamper = false) => {
        const plain = Buffer.from(JSON.stringify(payload))
        if (!encrypted) return writeFile(join(root, file), plain)
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', key, iv)
        const body = Buffer.concat([cipher.update(plain), cipher.final()])
        if (tamper) body[0] ^= 1
        await writeFile(
          join(root, file),
          Buffer.concat([Buffer.from('TCBK1'), iv, cipher.getAuthTag(), body]),
        )
      }
      await write('backup-2026-01-02T03-04-05-678Z.tcb', { files })
      const registry = join(base, 'flat.json')
      await writeFile(
        registry,
        JSON.stringify({
          [name]: { root, encrypted, ...(encrypted ? { key: key.toString('hex') } : {}) },
        }),
      )
      return { root, registry, write, files }
    }

    it('opens a .tcb archive from a flat registry with an upper-case name', async () => {
      const base = await scratch()
      const { registry: file } = await legacy(base, 'Old')
      const registry = createStorageRegistry({ file, defaultRoot: join(base, 's') })
      expect(await registry.list()).toEqual([expect.objectContaining({ name: 'Old', encrypted })])
      expect(await registry.test('Old')).toMatchObject({ ok: true })
      await registry.fetchLatest('Old', join(base, 'out'))
      expect(await readFile(join(base, 'out/state/a.txt'), 'utf8')).toBe('legacy-bytes')
      expect((await stat(join(base, 'out/workspace'))).isDirectory()).toBe(true)
    })

    it('picks the newest archive across both formats', async () => {
      const base = await scratch()
      const { registry: file } = await legacy(base, 'Old')
      const registry = createStorageRegistry({ file, defaultRoot: join(base, 's') })
      await registry.store('Old', await makeBackup(base)) // written now: newer than the 2026-01-02 .tcb
      await registry.fetchLatest('Old', join(base, 'out'))
      expect(await readFile(join(base, 'out/state/a.txt'), 'utf8')).toBe('hello')
    })

    it('refuses a tampered or traversing legacy archive and leaves nothing behind', async () => {
      const base = await scratch()
      const { registry: file, write, files, root } = await legacy(base, 'Old')
      const registry = createStorageRegistry({ file, defaultRoot: join(base, 's') })
      await write('backup-2027-01-01T00-00-00-000Z.tcb', {
        files: [...files, { path: '../escape', data: 'eA==' }],
      })
      await expect(registry.fetchLatest('Old', join(base, 'out'))).rejects.toThrow(
        /leaves|not a path/,
      )
      expect(await readdir(base)).not.toContain('out')
      expect(await readdir(base)).not.toContain('escape')
      if (encrypted) {
        await write('backup-2028-01-01T00-00-00-000Z.tcb', { files }, true)
        await expect(registry.fetchLatest('Old', join(base, 'out'))).rejects.toThrow(
          /authentication/,
        )
      }
      expect((await readdir(root)).length).toBeGreaterThan(1)
    })
  },
)
