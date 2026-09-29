/**
 * The shared comment stripper must not treat a string as a comment.
 *
 * Seven sweeps carried a byte-identical regex stripper with no notion of strings, and `netlify.ts` emits
 * a Netlify redirect whose glob is `"/*"`. The regex read that as a block-comment opener and deleted
 * everything up to the next block-comment terminator: 5764 of 16204 bytes, 36% of the file, gone before any sweep looked.
 *
 * The guard named `every deployed entry is told its server dir` was one of the seven, and the adapter it
 * could not see was the only one that was not told — `/api/health` answered 404 on the Netlify emulator
 * while that file passed (B-338).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { withoutComments } from './_helpers/adapter-source.js'

const NETLIFY = resolve(__dirname, '../../packages/theo/src/adapters/netlify.ts')

/** The stripper the seven copies used, kept here as the thing being replaced. */
function regexStripper(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('the comment stripper is not fooled by a string', () => {
  it('a glob that looks like a comment opener does not delete the rest', () => {
    const src = 'const a = "/*"\nconst kept = serverDirLiteral(opts)\nconst b = "*/"\n'

    expect(
      regexStripper(src),
      'the regex stripper stopped eating the code, so this case no longer describes the defect',
    ).not.toContain('serverDirLiteral(opts)')
    expect(withoutComments(src)).toContain('serverDirLiteral(opts)')
  })

  it('it still removes the comments it is for', () => {
    const src = '// a line comment\nconst a = 1 /* a block */\n/* multi\n   line */\nconst b = 2\n'
    const out = withoutComments(src)

    expect(out).not.toContain('a line comment')
    expect(out).not.toContain('a block')
    expect(out).not.toContain('multi')
    expect(out).toContain('const a = 1')
    expect(out).toContain('const b = 2')
  })

  it('a URL inside a string keeps its slashes', () => {
    // The old stripper guarded this with `(^|[^:])`, which is why `https://` survived it. A
    // string-aware scanner needs no such guard, and this pins that it did not regress.
    const src = `const u = 'https://example.com/a//b'\n`
    expect(withoutComments(src)).toContain('https://example.com/a//b')
  })

  it('the real netlify.ts keeps the code the old stripper ate', () => {
    // THE case, measured on the file that exposed it.
    const raw = readFileSync(NETLIFY, 'utf8')

    const eaten = raw.length - regexStripper(raw).length
    expect(
      eaten,
      'the regex stripper no longer eats this file, so the measurement above is stale',
    ).toBeGreaterThan(3000)

    expect(
      withoutComments(raw).includes('serverDirLiteral(opts)'),
      'the string-aware stripper also loses the call, so every sweep over this adapter is still blind',
    ).toBe(true)
  })
})
