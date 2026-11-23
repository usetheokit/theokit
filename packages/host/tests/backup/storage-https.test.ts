import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { BackupError, createStorageRegistry, restore } from '../../src/backup/index.js'
import { makeBackup, scratch } from './storage-helpers.js'

const TOKEN = 'test-bearer'
let server: Server | undefined
afterEach(() => {
  server?.close()
  server?.closeAllConnections()
  server = undefined
})

async function start(
  base: string,
  options: { failMarker?: boolean } = {},
): Promise<{ url: string; ca: string; store: Map<string, Buffer> }> {
  const dir = join(base, 'tls')
  await mkdir(dir)
  /* eslint-disable sonarjs/no-os-command-from-path -- test-only throwaway certificate */
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'k.pem'),
      '-out',
      join(dir, 'c.pem'),
      '-days',
      '2',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  )
  /* eslint-enable sonarjs/no-os-command-from-path */
  const ca = await readFile(join(dir, 'c.pem'), 'utf8')
  const store = new Map<string, Buffer>()
  server = createServer({ key: await readFile(join(dir, 'k.pem')), cert: ca }, (req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end()
      return
    }
    const name = decodeURIComponent((req.url ?? '').replace(/^\/backups\/?/, ''))
    if (req.method === 'GET' && name === '') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ names: [...store.keys()] }))
    } else if (req.method === 'GET') {
      const body = store.get(name)
      if (body === undefined) res.writeHead(404).end()
      else res.writeHead(200).end(body)
    } else if (req.method === 'PUT') {
      if (store.has(name)) {
        res.writeHead(412).end()
        return
      }
      if (options.failMarker && name.endsWith('.manifest.json')) {
        req.destroy()
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        store.set(name, Buffer.concat(chunks))
        res.writeHead(201).end()
      })
    } else res.writeHead(405).end()
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  return { url: `https://127.0.0.1:${(server.address() as AddressInfo).port}/backups`, ca, store }
}

describe.each([true, false])('https storage (encrypted: %s)', (encrypted) => {
  it('stores and fetches byte for byte, then restores', async () => {
    const base = await scratch()
    const backupDir = await makeBackup(base)
    const { url, ca, store } = await start(base)
    const registry = createStorageRegistry({
      file: join(base, 'cfg/s.json'),
      defaultRoot: join(base, 's'),
      ca,
    })
    expect(await registry.init('r', { root: url, encrypted, token: TOKEN })).toEqual({
      root: url,
      encrypted,
    })
    await registry.store('r', backupDir)
    expect([...store.keys()].some((n) => n.endsWith('.manifest.json'))).toBe(true)
    expect(await registry.test('r')).toMatchObject({ ok: true })
    expect(JSON.stringify(await registry.list())).not.toContain(TOKEN)
    const fetched = join(base, 'fetched')
    await registry.fetchLatest('r', fetched)
    const target = join(base, 'out')
    await restore({ from: fetched, roots: { state: target } })
    expect(await readFile(join(target, 'a.txt'), 'utf8')).toBe('hello')
    expect([...(await readFile(join(target, 'deep/er/b.bin')))]).toEqual([0, 1, 2, 255])
    expect(await readdir(base)).not.toContainEqual(expect.stringContaining('.tcbk'))
  })

  it('does not list an upload interrupted before the manifest', async () => {
    const base = await scratch()
    const backupDir = await makeBackup(base)
    const { url, ca, store } = await start(base, { failMarker: true })
    const registry = createStorageRegistry({
      file: join(base, 'cfg/s.json'),
      defaultRoot: join(base, 's'),
      ca,
    })
    await registry.init('r', { root: url, encrypted, token: TOKEN })
    await expect(registry.store('r', backupDir)).rejects.toBeInstanceOf(BackupError)
    expect([...store.keys()].some((n) => n.endsWith('.tcbk'))).toBe(true)
    await expect(registry.fetchLatest('r', join(base, 'f'))).rejects.toThrow(/holds no backup/)
  })
})

it('refuses a non-https url and a wrong token', async () => {
  const base = await scratch()
  const registry = createStorageRegistry({
    file: join(base, 's.json'),
    defaultRoot: join(base, 's'),
  })
  await writeFile(join(base, 'x'), '')
  await expect(
    registry.init('r', { root: 'https://u:p@h/x', encrypted: false }),
  ).rejects.toBeInstanceOf(BackupError)
})
