/**
 * B-145 — the last two unbounded subprocesses, both synchronous, both in the TUI.
 *
 * This release fixed the same defect three times: a timeout the operator could not reach (B-128), a
 * `git` call with none at all on the CLI's first line (B-137), and a child process spawned with no
 * bound by the fix for the second (B-144). After the third, the codebase was swept for the pattern
 * rather than waiting to trip over a fourth — and it had two more.
 *
 * Both are `spawnSync`, which does not merely take time: it blocks the event loop, and in the TUI
 * that is the Ink render loop. A frozen frame with no cursor is indistinguishable from a crash.
 *
 *   `clipboard.ts`          — `wl-copy`, `xclip`, `xsel`, `pbcopy`. These are exactly the binaries
 *                             that hang when a display server is set but not answering.
 *   `command-content.ts`    — two `git diff` calls behind `/diff`, on a working tree of any size.
 *
 * The clipboard's error handling is the toolkit's: `spawnSync` sets `result.error` on a timeout, and
 * the loop turns any non-ENOENT error into a `ClipboardWriteError`. What was missing was the bound
 * that produces one.
 */
import { describe, expect, it } from 'vitest'

import { ClipboardWriteError, copyToClipboard } from '../src/clipboard/clipboard.js'
import { DIFF_TIMEOUT_MS, diffSpawnOptions } from '../src/commands/command-content.js'

describe('the clipboard write is bounded', () => {
  it('test_the_toolkit_bound_reaches_the_runner_and_is_generous_enough', () => {
    // The bound is `@theokit/tui/terminal`'s now; what this app still owes is that a copy runs under
    // one. Too tight and a slow-but-working clipboard starts failing.
    let seen: number | undefined
    copyToClipboard('x', {
      candidates: [{ bin: 'xclip', args: [] }],
      runner: ((_b: string, _a: readonly string[], _i: string, timeoutMs: number) => {
        seen = timeoutMs
        return { status: 0 }
      }) as never,
    })
    expect(seen).toBeGreaterThanOrEqual(2_000)
  })

  it('test_a_timed_out_clipboard_is_reported_as_a_write_failure_not_a_success', () => {
    // The behaviour that matters. `spawnSync` reports a timeout through `error`, and the loop must
    // treat it as a real failure of an installed clipboard — not skip to the next candidate, and
    // certainly not return `{ bin }` as though the text had been copied.
    const timedOut = (): never =>
      ({
        error: Object.assign(new Error('spawnSync xclip ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        status: null,
        stdout: '',
        stderr: '',
      }) as never

    expect(() =>
      copyToClipboard('text', {
        runner: timedOut,
        candidates: [{ bin: 'xclip', args: ['-selection', 'clipboard'] }],
      }),
    ).toThrow(ClipboardWriteError)
  })
})

describe('the diff panel subprocesses are bounded', () => {
  it('test_it_declares_a_timeout', () => {
    expect(DIFF_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('test_the_bound_actually_REACHES_spawnSync', () => {
    expect(diffSpawnOptions().timeout).toBe(DIFF_TIMEOUT_MS)
  })

  it('test_the_bound_matches_the_one_the_review_path_already_uses', () => {
    // `/review` bounds its git calls at 10 s. Two different numbers for "how long may git take"
    // in one product is the inconsistency B-128 was about, one file over.
    expect(DIFF_TIMEOUT_MS).toBe(10_000)
  })
})
