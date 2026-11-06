import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { backupInstance, downloadBackup, restoreInstance, uploadBackup } from '../src/backup/backup.js'
import { takeInstanceLock } from '../src/backup/instance-lock.js'

const roots: string[] = []
afterEach(() => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function scratch() { const root = mkdtempSync(join(tmpdir(), 'offsite-')); roots.push(root); return root }

it('snapshots committed WAL sessions while running, uploads offsite and restores without sidecars', async () => {
  const root = scratch()
  const state = join(root, 'state'), workspace = join(root, 'workspace')
  mkdirSync(state); mkdirSync(workspace)
  const db = new DatabaseSync(join(state, 'sessions'))
  const lock = takeInstanceLock(state)
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE sessions (word TEXT); INSERT INTO sessions VALUES ('remember-me')")
    const objects = new Map<string, Uint8Array>()
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.origin).toBe('https://backup.example')
      expect(init.headers).toEqual({ Authorization: 'Bearer test-token', ...(init.method === 'PUT' ? { 'If-None-Match': '*' } : {}) })
      requests.push(`${init.method} ${url.pathname}`)
      if (init.method === 'PUT') { objects.set(url.pathname, init.body as Uint8Array); return new Response(null, { status: 201 }) }
      const bytes = objects.get(url.pathname)
      return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 })
    }))
    const env = { THEOCLAW_STATE_DIR: state, THEOCLAW_WORKSPACE: workspace, XDG_CONFIG_HOME: join(root, 'config') }
    const backup = join(root, 'backup')
    db.exec("BEGIN; INSERT INTO sessions VALUES ('uncommitted')")
    const manifest = backupInstance(env, backup, { homeDir: root, live: true })
    db.exec('ROLLBACK')
    expect(manifest.files.map((file) => file.path)).toEqual(['state/sessions'])
    await uploadBackup(backup, 'https://backup.example/snapshot', 'test-token')
    expect(requests.at(-1)).toBe('PUT /snapshot/manifest.json')
    rmSync(backup, { recursive: true })
    await downloadBackup(backup, 'https://backup.example/snapshot', 'test-token')
    const restored = join(root, 'restored')
    restoreInstance({ ...env, THEOCLAW_STATE_DIR: restored, THEOCLAW_WORKSPACE: join(root, 'new-workspace') }, backup, { homeDir: root })
    const check = new DatabaseSync(join(restored, 'sessions'))
    try {
      expect(check.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(check.prepare('SELECT word FROM sessions').all()).toEqual([{ word: 'remember-me' }])
    } finally { check.close() }
  } finally { db.close(); lock.release() }
})

it('does not publish a completion manifest after an upload failure', async () => {
  const root = scratch(), state = join(root, 'state'), workspace = join(root, 'workspace')
  mkdirSync(state); mkdirSync(workspace); writeFileSync(join(state, 'session'), 'history')
  const backup = join(root, 'backup')
  backupInstance({ THEOCLAW_STATE_DIR: state, THEOCLAW_WORKSPACE: workspace }, backup, { homeDir: root })
  const fetcher = vi.fn(async () => new Response(null, { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(uploadBackup(backup, 'https://backup.example/new')).rejects.toThrow('503')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(readFileSync(join(backup, 'state/session'), 'utf8')).toBe('history')
})

it('rejects a malicious downloaded manifest and removes the partial download', async () => {
  const root = scratch(), dir = join(root, 'download')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 1, files: [{ path: 'state/../../escape', sha256: '', size: 0 }] }))))
  await expect(downloadBackup(dir, 'https://backup.example/new')).rejects.toThrow('leaves state/')
  expect(existsSync(dir)).toBe(false)
  expect(existsSync(join(root, 'escape'))).toBe(false)
})

it('removes downloaded data whose hash does not match the manifest', async () => {
  const root = scratch(), dir = join(root, 'download')
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => new Response(url.pathname.endsWith('manifest.json')
    ? JSON.stringify({ version: 1, files: [{ path: 'state/session', sha256: '0'.repeat(64), size: 7 }] })
    : 'changed')))
  await expect(downloadBackup(dir, 'https://backup.example/new')).rejects.toThrow('does not match')
  expect(existsSync(dir)).toBe(false)
})

it('refuses insecure targets before sending any credentials', async () => {
  const dir = join(scratch(), 'download'), fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(downloadBackup(dir, 'http://backup.example/new', 'secret')).rejects.toThrow('HTTPS')
  expect(fetcher).not.toHaveBeenCalled()
  expect(existsSync(dir)).toBe(false)
})
