import { join } from 'node:path'

import { expect, it } from 'vitest'

import { backup, restore } from '../../src/backup/index.js'
import { put, scratch } from './support.js'

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
