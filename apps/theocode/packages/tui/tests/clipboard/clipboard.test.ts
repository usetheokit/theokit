/**
 * B-075 — the clipboard, and the honest failure when there is none.
 *
 * The runner is injected: a test shelling out to the real `wl-copy` would pass on this machine and
 * fail in CI, which is the flakiness `rules/testing.md` § 3 calls a bug.
 */
import { describe, expect, it } from 'vitest'

import { copyToClipboard } from '../../src/clipboard/clipboard.js'
import { NoClipboardError } from '../../src/clipboard/clipboard-errors.js'
import { ClipboardWriteError } from '../../src/clipboard/clipboard-write-error.js'
import type { ClipboardCommand } from '../../src/clipboard/clipboard-commands.js'

const CANDIDATES: readonly ClipboardCommand[] = [
  { bin: 'first', args: ['-a'] },
  { bin: 'second', args: [] },
]

const absent = { error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) }
const ok = { status: 0 }

/**
 * Adapt a partial `spawnSync` stub to the `Runner` the module expects.
 *
 * Every case below sets only the fields `copyToClipboard` branches on — `error` for a binary that
 * is not installed, `status` for one that is and refused the text. A real `SpawnSyncReturns<string>`
 * also carries `pid`, `output`, `stdout`, `stderr` and `signal`, and spelling those out per fixture
 * would bury the one field the case turns on under five the code never reads.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- widening is this helper's whole job, and keeping it here is what stops `any` reaching each fixture
const runner = (fn: (bin: string, args: readonly string[], input: string) => unknown): any => fn

describe('B-075 — copyToClipboard', () => {
  it('test_uses_the_first_binary_that_exists', () => {
    const calls: string[] = []
    const result = copyToClipboard('hello', {
      candidates: CANDIDATES,
      runner: runner((bin: string) => {
        calls.push(bin)
        return ok
      }),
    })
    expect(result.bin).toBe('first')
    expect(calls).toEqual(['first'])
  })

  it('test_falls_through_an_absent_binary_to_the_next', () => {
    const result = copyToClipboard('hello', {
      candidates: CANDIDATES,
      runner: runner((bin: string) => (bin === 'first' ? absent : ok)),
    })
    expect(result.bin).toBe('second')
  })

  it('test_passes_the_text_on_stdin', () => {
    let seen: string | undefined
    copyToClipboard('the answer', {
      candidates: CANDIDATES,
      runner: runner((_b: string, _a: readonly string[], input: string) => {
        seen = input
        return ok
      }),
    })
    expect(seen).toBe('the answer')
  })

  it('test_no_clipboard_at_all_is_a_typed_error', () => {
    // The headless case. A silent no-op is discovered by the user only when they paste.
    expect(() =>
      copyToClipboard('hello', { candidates: CANDIDATES, runner: runner(() => absent) }),
    ).toThrow(NoClipboardError)
  })

  it('test_the_error_names_what_to_do_instead', () => {
    expect(() =>
      copyToClipboard('hello', { candidates: CANDIDATES, runner: runner(() => absent) }),
    ).toThrow(/\/export/)
  })

  it('test_a_present_binary_that_fails_is_not_swallowed', () => {
    // Distinct from absence: a clipboard that IS installed and refused the text is a real failure,
    // and reporting "no clipboard" would send the user to install what they already have.
    expect(() =>
      copyToClipboard('hello', {
        candidates: CANDIDATES,
        runner: runner(() => ({ status: 1, stderr: 'display not found' })),
      }),
    ).toThrow(ClipboardWriteError)
  })
})
