import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { BackupError, downloadDirectory, uploadDirectory } from '../../src/backup/index.js'
import { makeBackup, scratch } from './storage-helpers.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('uploads every file then the manifest last, and downloads it back verified', async () => {
  const base = await scratch()
  const dir = await makeBackup(base)
  const objects = new Map<string, Uint8Array>()
  const order: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, init: RequestInit) => {
      expect(init.redirect).toBe('error')
      expect(init.headers).toMatchObject({ Authorization: 'Bearer t' })
      if (init.method === 'PUT') {
        order.push(url.pathname)
        objects.set(url.pathname, init.body as Uint8Array)
        return new Response(null, { status: 201 })
      }
      const body = objects.get(url.pathname)
      return new Response(body ? new Uint8Array(body) : null, { status: body ? 200 : 404 })
    }),
  )
  await uploadDirectory(dir, 'https://o.example/snap', { token: 't' })
  expect(order.at(-1)).toBe('/snap/manifest.json')
  expect(order).toContain('/snap/state/a.txt')
  const back = join(base, 'back')
  await downloadDirectory(back, 'https://o.example/snap', { token: 't' })
  expect(await readFile(join(back, 'state/a.txt'), 'utf8')).toBe('hello')
})

it('removes the directory of a download that fails and refuses an insecure target', async () => {
  const base = await scratch()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 })),
  )
  const back = join(base, 'back')
  await expect(downloadDirectory(back, 'https://o.example/x')).rejects.toBeInstanceOf(BackupError)
  expect(existsSync(back)).toBe(false)
  await mkdir(join(base, 'taken'))
  await expect(downloadDirectory(join(base, 'taken'), 'https://o.example/x')).rejects.toThrow(
    /absent/,
  )
  await writeFile(join(base, 'f'), '')
  await expect(downloadDirectory(join(base, 'n'), 'http://o.example/x')).rejects.toThrow(/HTTPS/)
})

it('does not publish the manifest after a failed upload', async () => {
  const base = await scratch()
  const dir = await makeBackup(base)
  const fetcher = vi.fn(async () => new Response(null, { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(uploadDirectory(dir, 'https://o.example/x')).rejects.toThrow('503')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('abandons a request that never answers', async () => {
  const base = await scratch()
  const dir = await makeBackup(base)
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    ),
  )
  await expect(
    uploadDirectory(dir, 'https://o.example/x', { timeoutMs: 50 }),
  ).rejects.toBeInstanceOf(BackupError)
})
