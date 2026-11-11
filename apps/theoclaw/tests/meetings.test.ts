import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { meetingsCommand } from '../src/meetings/meetings.js'

describe('theoclaw meetings', () => {
  it('joins a Meet link and lists the notes afterwards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meet-'))
    const out = new PassThrough()
    const chunks: string[] = []
    out.on('data', (c: Buffer) => chunks.push(String(c)))
    const io = {
      env: { THEOCLAW_STATE_DIR: dir },
      homeDir: dir,
      cwd: dir,
      stdout: out,
      stderr: new PassThrough(),
      transport: {
        join: (_url: string, o: { onLine: (s: string, t: string) => void }) => {
          o.onLine('Ana', 'ship it')
          return Promise.resolve()
        },
      },
    }
    await expect(meetingsCommand(['join', 'https://example.com/x'], io)).rejects.toThrow(
      /^theoclaw meetings join: expected a https:\/\/meet\.google\.com\/abc-defg-hij link$/,
    )
    await expect(
      meetingsCommand(['join', 'https://meet.google.com.evil.example/abc-defg-hij'], io),
    ).rejects.toThrow(/expected a https/)
    expect(await meetingsCommand(['join', 'https://meet.google.com/abc-defg-hij'], io)).toBe(0)
    const id = chunks.join('').trim()
    chunks.length = 0
    await meetingsCommand(['list'], io)
    expect(chunks.join('')).toContain(id)
    chunks.length = 0
    await meetingsCommand(['show', id], io)
    expect(chunks.join('')).toContain('**Ana:** ship it')
  })
})
