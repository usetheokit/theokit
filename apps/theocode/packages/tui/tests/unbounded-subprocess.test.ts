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
 * The clipboard's error handling was already right: `spawnSync` sets `result.error` on a timeout, and
 * the loop turns any non-ENOENT error into a `ClipboardWriteError`. What was missing was the bound
 * that produces one.
 */
import { describe, expect, it } from 'vitest'

import { CLIPBOARD_TIMEOUT_MS, clipboardSpawnOptions, copyToClipboard } from '../src/clipboard/clipboard.js'
import { ClipboardWriteError } from '../src/clipboard/clipboard-write-error.js'
import { DIFF_TIMEOUT_MS, diffSpawnOptions } from '../src/commands/command-content.js'

describe('the clipboard write is bounded', () => {
  it('test_it_declares_a_timeout', () => {
    expect(CLIPBOARD_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('test_the_bound_actually_REACHES_spawnSync', () => {
    // A mutation check found this missing: the test suite asserted the constant existed and never
    // that it was passed, so deleting `timeout:` from the call left everything green. That is the
    // same defect as the collector's `apply: true`, twice in one release.
    expect(clipboardSpawnOptions('x').timeout).toBe(CLIPBOARD_TIMEOUT_MS)
  })

  it('test_the_bound_is_generous_enough_for_a_real_clipboard', () => {
    // Copying text is instant on a working desktop; the bound exists for the one that is not
    // answering. Too tight and a slow-but-working clipboard starts failing.
    expect(CLIPBOARD_TIMEOUT_MS).toBeGreaterThanOrEqual(2_000)
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
