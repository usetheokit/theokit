import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

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

const events: string[] = []

vi.mock('node:fs/promises', async (importOriginal) => {
  const real: Record<string, any> = await importOriginal()
  const spy =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      events.push('read')
      return fn(...args)
    }
  return { ...real, lstat: spy(real.lstat), readdir: spy(real.readdir), stat: spy(real.stat) }
})
vi.mock('node:fs', async (importOriginal) => {
  const real: Record<string, any> = await importOriginal()
  const spy =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      events.push('read')
      return fn(...args)
    }
  return { ...real, existsSync: spy(real.existsSync), realpathSync: spy(real.realpathSync) }
})

const { backup, restore } = await import('../../src/backup/index.js')

it('backup acquires the lock before its first filesystem read', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'x', '1')
  events.length = 0
  const lock = async () => {
    events.push('acquire')
    return async () => {}
  }
  await backup({ roots: { a }, out: join(base, 'out'), lock })
  expect(events[0]).toBe('acquire')
  expect(events).toContain('read')
})

it('restore acquires the lock before its first filesystem read', async () => {
  const base = await scratch()
  const a = join(base, 'a')
  await put(a, 'x', '1')
  const from = join(base, 'bak')
  await backup({ roots: { a }, out: from })
  events.length = 0
  const lock = async () => {
    events.push('acquire')
    return async () => {}
  }
  await restore({ from, roots: { a: join(base, 't') }, lock })
  expect(events[0]).toBe('acquire')
  expect(events).toContain('read')
})
