import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Writable } from 'node:stream'
import { createCipheriv, randomBytes } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { type CliIo, runCli } from '../src/cli.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'storage-'))
  roots.push(root)
  const state = join(root, 'state'),
    workspace = join(root, 'workspace')
  mkdirSync(state)
  mkdirSync(workspace)
  writeFileSync(join(state, 'session'), 'secret-history')
  let out = '',
    err = ''
  const io = {
    env: {
      THEOCLAW_STATE_DIR: state,
      THEOCLAW_WORKSPACE: workspace,
      XDG_CONFIG_HOME: join(root, 'config'),
    },
    homeDir: root,
    stdout: new Writable({
      write(c, _e, cb) {
        out += String(c)
        cb()
      },
    }),
    stderr: new Writable({
      write(c, _e, cb) {
        err += String(c)
        cb()
      },
    }),
  } as unknown as CliIo
  return { root, state, workspace, io, out: () => out, err: () => err }
}

it('inits an encrypted location, backs up into it, tests it and restores from it', async () => {
  const t = setup()
  expect(await runCli(['storage', 'init', 'archive'], t.io)).toBe(0)
  expect(await runCli(['backup', '--to', 'archive'], t.io)).toBe(0)
  const dir = join(t.root, 'config/theoclaw/storage/archive')
  const archives = readdirSync(dir).filter((f) => f.endsWith('.tcbk'))
  expect(archives).toHaveLength(1)
  expect(readFileSync(join(dir, archives[0]!)).includes('secret-history')).toBe(false)
  expect(
    readFileSync(join(dir, archives[0]!))
      .toString('base64')
      .includes(Buffer.from('secret-history').toString('base64')),
  ).toBe(false)
  expect(await runCli(['storage', 'test', 'archive'], t.io)).toBe(0)
  expect(t.out()).toContain('"state":"ok","encrypted":true')
  expect(await runCli(['storage', 'list'], t.io)).toBe(0)
  const restored = {
    ...t.io,
    env: {
      ...t.io.env,
      THEOCLAW_STATE_DIR: join(t.root, 'r-state'),
      THEOCLAW_WORKSPACE: join(t.root, 'r-ws'),
    },
  }
  expect(await runCli(['restore', '--from', 'archive'], restored)).toBe(0)
  expect(readFileSync(join(t.root, 'r-state/session'), 'utf8')).toBe('secret-history')
  expect(existsSync(join(dir, '.probe'))).toBe(false)
})

it('refuses an unknown location and a duplicate init', async () => {
  const t = setup()
  expect(await runCli(['backup', '--to', 'nope'], t.io)).toBe(1)
  expect(await runCli(['storage', 'init', 'a', '--no-encrypt'], t.io)).toBe(0)
  expect(await runCli(['storage', 'init', 'a'], t.io)).toBe(1)
  expect(await runCli(['storage', 'test', 'a'], t.io)).toBe(0)
})

it('restores from a registry and an archive written by the earlier TheoClaw build', async () => {
  const t = setup()
  const dir = join(t.root, 'old-archives')
  mkdirSync(dir)
  const key = randomBytes(32)
  const files = { 'state/session': 'old-history', 'workspace/notes.md': 'old-notes' }
  const sha = (v: string) => createHash('sha256').update(v).digest('hex')
  const manifest = {
    version: 1,
    files: Object.entries(files).map(([path, v]) => ({ path, sha256: sha(v), size: v.length })),
  }
  const payload = {
    files: [
      ...Object.entries(files).map(([path, v]) => ({ path, data: Buffer.from(v).toString('base64') })),
      { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)).toString('base64') },
    ],
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload))), cipher.final()])
  writeFileSync(
    join(dir, 'backup-2026-01-02T03-04-05-678Z.tcb'),
    Buffer.concat([Buffer.from('TCBK1'), iv, cipher.getAuthTag(), body]),
  )
  mkdirSync(join(t.root, 'config/theoclaw'), { recursive: true })
  writeFileSync(
    join(t.root, 'config/theoclaw/storage.json'),
    JSON.stringify({ Old: { root: dir, encrypted: true, key: key.toString('hex') } }),
  )
  const restored = {
    ...t.io,
    env: { ...t.io.env, THEOCLAW_STATE_DIR: join(t.root, 'r-state'), THEOCLAW_WORKSPACE: join(t.root, 'r-ws') },
  }
  expect(await runCli(['restore', '--from', 'Old'], restored)).toBe(0)
  expect(readFileSync(join(t.root, 'r-state/session'), 'utf8')).toBe('old-history')
  expect(readFileSync(join(t.root, 'r-ws/notes.md'), 'utf8')).toBe('old-notes')
  expect(await runCli(['storage', 'test', 'Old'], t.io)).toBe(0)
})
