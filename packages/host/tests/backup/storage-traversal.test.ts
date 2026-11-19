import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { containedPath, unpackInto } from '../../src/backup/archive.js'
import { BackupError } from '../../src/backup/index.js'
import { scratch } from './storage-helpers.js'

describe('containedPath', () => {
  it.each([
    ['posix', path.posix, '/base/dir', []],
    ['win32', path.win32, 'C:\\base\\dir', ['C:/x', 'C:x', 'C:\\x']],
  ] as const)('refuses escaping entries on %s paths', (_name, impl, base, extra) => {
    const entries = ['../x', 'a/../../x', '/x', '\\x', '..\\x', '', 'a//b', './a', 'a\0b', ...extra]
    for (const entry of entries) {
      expect(() => containedPath(base, entry, impl), entry).toThrow(BackupError)
    }
    expect(containedPath(base, 'a/b.txt', impl)).toBe(impl.join(base, 'a', 'b.txt'))
  })
})

function entry(type: number, name: string, body?: Buffer): Buffer {
  const bytes = Buffer.from(name)
  const head = Buffer.alloc(3)
  head[0] = type
  head.writeUInt16BE(bytes.length, 1)
  const parts: Buffer[] = [head, bytes]
  if (body !== undefined) {
    const size = Buffer.alloc(8)
    size.writeBigUInt64BE(BigInt(body.length))
    parts.push(size, body)
  }
  return Buffer.concat(parts)
}

async function* from(...chunks: Buffer[]): AsyncGenerator<Buffer> {
  yield* chunks
}

describe('unpackInto', () => {
  it.each(['../x', '/etc/x', 'a/../../x'])(
    'refuses the entry %s and writes nothing outside',
    async (name) => {
      const base = await scratch()
      const target = path.join(base, 'target')
      await mkdir(target)
      await expect(
        unpackInto(from(entry(2, name, Buffer.from('x')), Buffer.from([0])), target),
      ).rejects.toBeInstanceOf(BackupError)
      expect(await readdir(base)).toEqual(['target'])
      expect(await readdir(target)).toEqual([])
    },
  )

  it('refuses a duplicate entry', async () => {
    const base = await scratch()
    const dup = entry(2, 'a', Buffer.from('1'))
    await expect(unpackInto(from(dup, dup, Buffer.from([0])), base)).rejects.toBeInstanceOf(
      BackupError,
    )
  })
})
