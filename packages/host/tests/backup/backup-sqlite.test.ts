import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { backup } from '../../src/backup/index.js'
import { scratch } from './support.js'

it('snapshots a database with an open WAL writer, without sidecars', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const base = await scratch()
  const src = join(base, 'src')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(src)
  const db = new DatabaseSync(join(src, 'state.db'))
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1), (2);')
  expect(existsSync(join(src, 'state.db-wal'))).toBe(true)
  const out = join(base, 'out')
  try {
    const manifest = await backup({ roots: { data: src }, out })
    expect(manifest.files.map((f) => f.path)).toEqual(['data/state.db'])
  } finally {
    db.close()
  }
  expect(existsSync(join(out, 'data/state.db-wal'))).toBe(false)
  expect(existsSync(join(out, 'data/state.db-shm'))).toBe(false)
  const copy = new DatabaseSync(join(out, 'data/state.db'), { readOnly: true })
  expect(copy.prepare('SELECT n FROM t ORDER BY n').all()).toEqual([{ n: 1 }, { n: 2 }])
  copy.close()
})

it('leaves the sidecars of an excluded database out, with a WAL writer open', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const base = await scratch()
  const src = join(base, 'src')
  mkdirSync(src)
  const db = new DatabaseSync(join(src, 'secret.db'))
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1);')
  writeFileSync(join(src, 'keep.txt'), 'k')
  expect(existsSync(join(src, 'secret.db-wal'))).toBe(true)
  const out = join(base, 'out')
  try {
    const manifest = await backup({
      roots: { data: src },
      out,
      exclude: (_root, rel) => rel === 'secret.db',
    })
    expect(manifest.files.map((f) => f.path)).toEqual(['data/keep.txt'])
  } finally {
    db.close()
  }
  expect(existsSync(join(out, 'data/secret.db-wal'))).toBe(false)
  expect(existsSync(join(out, 'data/secret.db-shm'))).toBe(false)
})
