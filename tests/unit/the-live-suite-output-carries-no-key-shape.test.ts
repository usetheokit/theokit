import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { redactStream } from '../../scripts/redact-key-shapes.mjs'

/**
 * The live suite prints provider text cut at a fixed length (`live-m54-loop-strategy.test.ts:89`
 * slices at 200, `live-m52-capability.test.ts:141` at 600, `live-m55-tool-name.test.ts:100` at
 * 300), so a key-shaped string in a model answer can reach the CI log cut in half, where GitHub's
 * exact-value masking does not see it. Replayed with 150 filler characters and a 64-hex key, the
 * M54 line exposed 41 hex characters (B-415, panel finding CX-6). The live-model job pipes the
 * suite's whole output through `redact-key-shapes.mjs`; these cases replay each logging line.
 */
const SHAPE = /sk-or-v1-[0-9a-f]{16,}/i
const FILTER = resolve(__dirname, '../../scripts/redact-key-shapes.mjs')
const KEY = 'sk-or-v1-' + '0123456789abcdef'.repeat(4)
const ANSWER = 'x'.repeat(150) + KEY

async function filter(chunks: readonly string[], key: string): Promise<string> {
  const input = new PassThrough()
  const output = new PassThrough()
  let written = ''
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString()
  })
  const done = redactStream(input, output, key)
  for (const chunk of chunks) input.write(chunk)
  input.end()
  await done
  return written
}

describe('redactStream', () => {
  it('redacts the truncated key the M54 response line prints', async () => {
    const line = `[live] response: ${ANSWER.slice(0, 200)}\n`
    expect(line).toMatch(SHAPE)
    expect(await filter([line], KEY)).not.toMatch(SHAPE)
  })

  it.each([
    ['m52 result slice 600', `[live] result: ${JSON.stringify({ text: ANSWER }).slice(0, 600)}\n`],
    ['m55 answer slice 300', `[live] answer: ${ANSWER.slice(0, 300)}\n`],
  ])('redacts the %s line', async (_name, line) => {
    expect(line).toMatch(SHAPE)
    expect(await filter([line], KEY)).not.toMatch(SHAPE)
  })

  it('redacts a key the M52 stream splits across two writes', async () => {
    // Cut where neither chunk alone carries the shape (11 hex digits, then no prefix), so a
    // per-chunk filter would leak it and only a line-based one redacts it.
    const output = await filter(['x'.repeat(150) + KEY.slice(0, 20), KEY.slice(20) + '\n'], KEY)
    expect(output).not.toMatch(SHAPE)
  })

  it('redacts a foreign key-shaped string with no configured key', async () => {
    const output = await filter([`answer sk-or-v1-${'a'.repeat(40)} end\n`], '')
    expect(output).toBe('answer *** end\n')
  })

  it('passes ordinary lines through unchanged and keeps a last line with no newline', async () => {
    const input = 'Test Files  3 passed (3)\n      Tests  4 passed (4)'
    expect(await filter([input], KEY)).toBe(input + '\n')
  })

  it('filters stdin to stdout as a process and exits 0', () => {
    const result = spawnSync(process.execPath, [FILTER], {
      input: `[live] response: ${ANSWER.slice(0, 200)}\n`,
      env: { OPENROUTER_API_KEY: KEY },
      encoding: 'utf8',
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[live] response: ')
    expect(result.stdout).not.toMatch(SHAPE)
  })
})
