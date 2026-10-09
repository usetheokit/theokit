import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { redactThenCut } from '../live/provider-text.js'

/**
 * The live suite logs provider text cut at a fixed length. Cut first and redacted later, a key the
 * model echoed reaches the log as a fragment the CI filter cannot tie to a key (B-415, delivery
 * audit L1). `redactThenCut` redacts every configured provider key on the whole text, then cuts.
 */
const KEY = 'sk-or-v1-' + '0123456789abcdef'.repeat(4)
const LIVE_DIR = join(__dirname, '../live')

describe('redactThenCut', () => {
  it('redacts a key echoed where the 300-character cut would leave 10 hex digits', () => {
    const echo = 'x'.repeat(300 - 'sk-or-v1-'.length - 10) + KEY
    expect(redactThenCut(echo, 300, { OPENROUTER_API_KEY: KEY })).toBe(`${'x'.repeat(281)}***`)
  })

  it('redacts a prefix-less tail of a key held in any provider variable', () => {
    const text = `tail ${KEY.slice(-20)} end`
    expect(redactThenCut(text, 300, { ANTHROPIC_API_KEY: KEY })).toBe('tail *** end')
  })

  it('leaves ordinary text untouched and cuts it at the limit', () => {
    const text = 'The counter is 3. '.repeat(30)
    expect(redactThenCut(text, 200, { OPENROUTER_API_KEY: KEY })).toBe(text.slice(0, 200))
  })
})

describe('the live suite', () => {
  // Any cut, not only one on the same line as a console call: a slice stored in a variable and
  // logged later, or written with process.stdout.write, leaks the same fragment (review F-tests-6).
  // A live test has no other reason to cut text, so every cut goes through redactThenCut.
  it('cuts no text except through redactThenCut', () => {
    const files = readdirSync(LIVE_DIR).filter((name) => name.endsWith('.test.ts'))
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.flatMap((name) =>
      readFileSync(join(LIVE_DIR, name), 'utf8')
        .split('\n')
        .map((line, index) => ({ line, at: `${name}:${String(index + 1)}` }))
        .filter(({ line }) => /\.(slice|substring|substr)\(/.test(line))
        .map(({ at }) => at),
    )
    expect(offenders).toEqual([])
  })
})
