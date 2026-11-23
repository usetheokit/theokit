import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { teeOutput } from '../../src/service/index.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup(maxBytes: number, keep: number) {
  const dir = mkdtempSync(join(tmpdir(), 'host-tee-'))
  dirs.push(dir)
  const file = join(dir, 'out.log')
  const stream = new PassThrough() as unknown as NodeJS.WriteStream
  const original = stream.write
  const restore = teeOutput({ file, streams: [stream], maxBytes, keep })
  return { file, stream, restore, original }
}

describe('teeOutput', () => {
  it('mirrors output into a 0600 file and restores the stream', () => {
    const { file, stream, restore, original } = setup(100, 1)
    stream.write('hello\n')
    expect(readFileSync(file, 'utf8')).toBe('hello\n')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    restore()
    expect(stream.write).toBe(original)
  })

  it('never exceeds maxBytes and keeps at most `keep` older files', () => {
    const { file, stream, restore } = setup(10, 2)
    for (let i = 0; i < 20; i++) stream.write('abcdef\n')
    stream.write('x'.repeat(35))
    restore()
    for (const f of [file, `${file}.1`, `${file}.2`]) {
      expect(statSync(f).size).toBeLessThanOrEqual(10)
    }
    expect(existsSync(`${file}.3`)).toBe(false)
  })

  it('keeps no older file when keep is 0', () => {
    const { file, stream, restore } = setup(5, 0)
    stream.write('0123456789')
    restore()
    expect(existsSync(`${file}.1`)).toBe(false)
    expect(statSync(file).size).toBeLessThanOrEqual(5)
  })
})
