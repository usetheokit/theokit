import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { backup, restore } from '../../src/backup/index.js'

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

it('acquires the lock before the first read and releases it after a failure', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'x', '1')
  const events: string[] = []
  const lock = async () => {
    events.push('acquire')
    return async () => {
      events.push('release')
    }
  }
  await expect(
    backup({
      roots: { a },
      out: join(base, 'out'),
      lock,
      exclude: () => {
        events.push('read')
        throw new Error('boom')
      },
    }),
  ).rejects.toThrow('boom')
  expect(events).toEqual(['acquire', 'read', 'release'])
})

it('holds the lock around restore and releases it when the backup is bad', async () => {
  const base = await scratch()
  const events: string[] = []
  const lock = () => {
    events.push('acquire')
    return async () => {
      events.push('release')
    }
  }
  await expect(
    restore({ from: join(base, 'missing'), roots: { a: join(base, 't') }, lock }),
  ).rejects.toThrow()
  expect(events).toEqual(['acquire', 'release'])
})

it('takes the lock before the overlap check reads the filesystem', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'x', '1')
  const events: string[] = []
  const lock = () => {
    events.push('acquire')
    return async () => {
      events.push('release')
    }
  }
  await expect(backup({ roots: { a }, out: join(a, 'out'), lock })).rejects.toThrow(/overlap/)
  expect(events).toEqual(['acquire', 'release'])
})

it('backup reads nothing before the lock is held', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  const out = join(base, 'out')
  await put(out, 'stale', 'x') // makes `out` non-empty until the lock empties it
  const lock = async () => {
    // State that only exists once the lock is held: any earlier read sees the old state and rejects.
    await rm(out, { recursive: true })
    await put(a, 'x', '1')
    return async () => {}
  }
  const manifest = await backup({ roots: { a }, out, lock })
  expect(manifest.files.map((f) => f.path)).toEqual(['a/x'])
})

it('restore reads nothing before the lock is held', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'x', '1')
  const from = join(base, 'bak')
  const lock = async () => {
    await backup({ roots: { a }, out: from })
    return async () => {}
  }
  const manifest = await restore({ from, roots: { a: join(base, 't') }, lock })
  expect(manifest.files.map((f) => f.path)).toEqual(['a/x'])
})
