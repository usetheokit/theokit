import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

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
const { put, scratch } = await import('./support.js')

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
