/**
 * B-013 — a background write that fails must be reported, not crash the UI.
 *
 * Two persistence calls were fired with `void` and no handler. `enqueue` attaches a `catch` to the
 * TAIL it stores, not to the promise it returns, so a rejection reached the `void` expression
 * unhandled. `atomicWriteText` genuinely rejects — ENOSPC, EACCES, EROFS, EXDEV — and the declared
 * engine is `node >=22`, whose default is `--unhandled-rejections=throw`. A failed pointer write
 * would terminate the TUI rather than degrade it.
 *
 * Neither extreme is right here: crashing the whole session because a session-id pointer could not
 * be written is disproportionate, and swallowing it silently is Unbreakable Rule 8. So it degrades,
 * loudly, through the diagnostic sink the TUI already routes to `.theokit/tui-stderr.log`.
 */
import { describe, expect, it, vi } from 'vitest'

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fireAndForget } from '../../src/persistence/fire-and-forget.js'
import { persistSessionId } from '../../src/persistence/session-store.js'

describe('B-013 — background writes degrade instead of crashing', () => {
  it('test_a_failing_write_is_reported_and_does_not_reject', async () => {
    const report = vi.fn()
    const boom = new Error('ENOSPC: no space left on device')

    // Must not reject: the caller is a `void` expression with no handler of its own.
    await expect(
      fireAndForget(Promise.reject(boom), 'session pointer', report),
    ).resolves.toBeUndefined()

    expect(report).toHaveBeenCalledOnce()
    expect(report.mock.calls[0]?.[0]).toMatch(/session pointer/)
    expect(report.mock.calls[0]?.[0]).toMatch(/ENOSPC/)
  })

  it('test_a_successful_write_reports_nothing', () => {
    // Anti-vacuity floor: reporting unconditionally would satisfy the assertion above.
    const report = vi.fn()

    return fireAndForget(Promise.resolve('ok'), 'session pointer', report).then(() => {
      expect(report).not.toHaveBeenCalled()
    })
  })

  it('test_a_non_error_rejection_is_still_reported', () => {
    const report = vi.fn()

    return fireAndForget(Promise.reject('plain string'), 'goal state', report).then(() => {
      expect(report).toHaveBeenCalledOnce()
      expect(report.mock.calls[0]?.[0]).toMatch(/goal state/)
    })
  })
})

describe('B-031 — no exported persist function can reject', () => {
  it('test_persistSessionId_does_not_reject_when_the_write_fails', async () => {
    // B-013 wrapped TWO call sites and its own docstring said "the two persistence calls". There
    // were FIVE. The three it missed — /new, /clear, /fork, the Esc interrupt and the backtrack
    // confirm — handed a bare `void` to a promise whose rejection is uncaught BY CONSTRUCTION
    // (`enqueue` attaches its catch to the tail it stores, not to the promise it returns), under
    // `node >=22` where the default is --unhandled-rejections=throw.
    //
    // Wrapping the three would have left the sixth call site to be discovered later. The guarantee
    // belongs to the exported function: there is no longer a persist export that CAN reject.
    const reports: string[] = []
    const dir = mkdtempSync(join(tmpdir(), 'theocode-persist-'))
    // A regular FILE where a directory is needed: the write fails with ENOTDIR. A merely absent
    // directory does NOT work here — `atomicWriteText` creates it, which a first version of this
    // test did not know and which made its premise false.
    writeFileSync(join(dir, 'blocker'), 'not a directory')
    const unwritable = join(dir, 'blocker', 'pointer')

    await expect(
      persistSessionId(unwritable, 'tui-1', (m) => reports.push(m)),
      'a failed pointer write rejected, and a bare `void` caller would crash the TUI',
    ).resolves.toBeUndefined()

    expect(reports.join(' '), 'the failure was swallowed with no diagnostic').toMatch(
      /could not persist/i,
    )
    rmSync(dir, { recursive: true, force: true })
  })

  it('test_a_successful_persist_reports_nothing_and_writes', async () => {
    // Anti-vacuity floor: reporting on every write would satisfy the assertion above.
    const reports: string[] = []
    const dir = mkdtempSync(join(tmpdir(), 'theocode-persist-'))
    const file = join(dir, 'pointer')

    await persistSessionId(file, 'tui-42', (m) => reports.push(m))

    expect(readFileSync(file, 'utf8')).toBe('tui-42')
    expect(reports).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })
})
