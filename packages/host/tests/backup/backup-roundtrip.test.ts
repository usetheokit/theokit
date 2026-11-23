import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { backup, rehomeTranscripts, restore } from '../../src/backup/index.js'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function scratch(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'host-backup-'))
  dirs.push(d)
  return d
}

async function put(root: string, rel: string, data: string | Buffer): Promise<void> {
  const file = join(root, rel)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, data)
}

it('backs up two roots and restores them byte for byte', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  const b = join(base, 'b')
  await put(a, 'x.txt', 'hello')
  await put(a, 'deep/er/y.bin', Buffer.from([0, 1, 2, 255]))
  await put(b, 'z.txt', 'zed')
  const out = join(base, 'out')
  const copied: string[] = []
  const manifest = await backup({
    roots: { alpha: a, beta: b },
    out,
    onFileCopied: (p) => copied.push(p),
  })
  expect(manifest.roots).toEqual(['alpha', 'beta'])
  expect(manifest.files.map((f) => f.path).sort((x, y) => x.localeCompare(y))).toEqual([
    'alpha/deep/er/y.bin',
    'alpha/x.txt',
    'beta/z.txt',
  ])
  expect([...copied].sort((x, y) => x.localeCompare(y))).toEqual(
    manifest.files.map((f) => f.path).sort((x, y) => x.localeCompare(y)),
  )

  const ta = join(base, 'ta')
  const tb = join(base, 'tb')
  await restore({ from: out, roots: { alpha: ta, beta: tb } })
  expect(await readFile(join(ta, 'x.txt'), 'utf8')).toBe('hello')
  expect([...(await readFile(join(ta, 'deep/er/y.bin')))]).toEqual([0, 1, 2, 255])
  expect(await readFile(join(tb, 'z.txt'), 'utf8')).toBe('zed')
  if (process.platform !== 'win32') {
    expect((await stat(join(out, 'alpha/x.txt'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(out, 'alpha/deep'))).mode & 0o777).toBe(0o700)
    expect((await stat(out)).mode & 0o777).toBe(0o700)
    expect((await stat(join(ta, 'deep/er/y.bin'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(ta, 'deep'))).mode & 0o777).toBe(0o700)
  }
})

it('refuses a non-empty output', async () => {
  const base = await scratch()
  await put(join(base, 'a'), 'x', '1')
  await put(join(base, 'out'), 'old', '1')
  await expect(backup({ roots: { a: join(base, 'a') }, out: join(base, 'out') })).rejects.toThrow(
    /not empty/,
  )
})

it('sets an existing empty output directory to 0700', async () => {
  if (process.platform === 'win32') return
  const base = await scratch()
  await put(join(base, 'a'), 'x', '1')
  const out = join(base, 'out')
  await mkdir(out, { mode: 0o755 })
  await chmod(out, 0o755)
  await backup({ roots: { a: join(base, 'a') }, out })
  expect((await stat(out)).mode & 0o777).toBe(0o700)
})

it.skipIf(process.platform === 'win32')('round-trips a file name holding a backslash', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'we\\ird.txt', 'odd')
  const out = join(base, 'out')
  await backup({ roots: { a }, out })
  const target = join(base, 'target')
  await restore({ from: out, roots: { a: target } })
  expect(await readFile(join(target, 'we\\ird.txt'), 'utf8')).toBe('odd')
})

it('restore with transform writes the mapped path only, and rejects escapes and collisions', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'old/x.txt', 'hello')
  await put(a, 'old/y.txt', 'why')
  const out = join(base, 'out')
  await backup({ roots: { alpha: a }, out })
  const target = join(base, 'restored')
  await restore({
    from: out,
    roots: { alpha: target },
    transform: (rel) => rel.replace(/^old\//, 'new/'),
  })
  expect(await readFile(join(target, 'new/x.txt'), 'utf8')).toBe('hello')
  await expect(stat(join(target, 'old'))).rejects.toThrow()
  const other = join(base, 'other')
  await expect(
    restore({ from: out, roots: { alpha: other }, transform: () => '../escape' }),
  ).rejects.toThrow(/outside its root/)
  await expect(
    restore({ from: out, roots: { alpha: other }, transform: () => 'same' }),
  ).rejects.toThrow(/two files/)
  await expect(stat(other)).rejects.toThrow()
})

it('restores to a new project path and resumes the session there', async () => {
  const { listSessions, transcriptPath } = await import('@theokit/sdk/persistence')
  const base = await scratch()
  const state = join(base, 'state')
  const oldCwd = join(base, 'old-project')
  const newCwd = join(base, 'new-project')
  const id = 'session-1'
  const record = JSON.stringify({ type: 'user', sessionId: id, cwd: oldCwd }) + '\n'
  const rel = (cwd: string): string => transcriptPath('.app', cwd, id)
  await put(state, rel(oldCwd), record)
  await put(state, 'other/keep.txt', 'k')
  const out = join(base, 'out')
  await backup({ roots: { state }, out })
  const target = join(base, 'restored')
  await restore({
    from: out,
    roots: { state: target },
    transform: rehomeTranscripts({
      root: 'state',
      projectsDir: '.app/projects',
      from: oldCwd,
      to: newCwd,
    }),
  })
  expect(await readFile(join(target, rel(newCwd)), 'utf8')).toBe(record)
  await expect(stat(join(target, rel(oldCwd)))).rejects.toThrow()
  expect(await readFile(join(target, 'other/keep.txt'), 'utf8')).toBe('k')
  const found = await listSessions(newCwd, { baseDir: join(target, '.app') })
  expect(found.map((s) => s.id)).toEqual([id])
})
