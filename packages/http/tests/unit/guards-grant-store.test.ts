import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createGrantStore } from '../../src/guards/index.js'

const file = (): string => join(mkdtempSync(join(tmpdir(), 'grants-')), 'sub', 'grants.json')

describe('createGrantStore', () => {
  it('authenticates a created credential and stops after revoke', async () => {
    const path = file()
    const store = createGrantStore(path)
    const { credential, grant } = await store.create('alice', ['read_file'])
    expect(grant.scopes).toEqual(['read_file'])
    expect((await store.authenticate(credential))?.name).toBe('alice')
    expect(await store.authenticate('nope')).toBeUndefined()
    // another instance on the same file sees the revoke at once
    expect(await createGrantStore(path).revoke('alice')).toBe(true)
    expect(await store.authenticate(credential)).toBeUndefined()
    expect(await store.revoke('alice')).toBe(false)
  })

  it('stores no credential in clear', async () => {
    const path = file()
    const store = createGrantStore(path)
    const { credential } = await store.create('bob', ['a'])
    const text = readFileSync(path, 'utf8')
    expect(text).not.toContain(credential)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('keeps concurrent creates and refuses duplicate or bad names', async () => {
    const store = createGrantStore(file())
    await Promise.all([store.create('a', ['x']), store.create('b', ['x']), store.create('c', [])])
    expect((await store.list()).map((g) => g.name).sort((a, b) => a.localeCompare(b))).toEqual([
      'a',
      'b',
      'c',
    ])
    await expect(store.create('a', ['x'])).rejects.toThrow(/exists/)
    await expect(store.create('bad name', [])).rejects.toThrow(/invalid/)
  })

  it('keeps every create when separate stores race on one file', async () => {
    const path = file()
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => createGrantStore(path).create(`n${i}`, ['x'])),
    )
    expect(await createGrantStore(path).list()).toHaveLength(12)
  })

  it('fails closed on a corrupt entry with a typed error', async () => {
    const path = file()
    const store = createGrantStore(path)
    await store.create('a', ['x'])
    writeFileSync(path, JSON.stringify({ grants: [{ name: 1 }] }))
    await expect(store.authenticate('x')).rejects.toThrow(/malformed/)
  })
})
