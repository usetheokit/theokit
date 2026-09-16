/**
 * B-039 — a diagnostic that could not be written is not silently lost.
 *
 * `installStderrGuard` redirects `process.stderr.write` to a log file so a warning cannot corrupt
 * the Ink frame. Its `catch` was empty and it returned `true` unconditionally, and `mkdirSync`
 * failure was already commented as "guarded writes below will no-op". On a non-writable path the
 * TUI therefore ran with EVERY diagnostic dead and nothing said so.
 *
 * That channel is not incidental. It is the sole output of the B-031 degradation reports, of hook
 * approval failures, and of the backtrack fork trace.
 *
 * Falling back to the real stderr — what `shared/diagnostic-sink.ts` does — is wrong HERE: writing
 * to stderr mid-frame corrupts the display, which is the entire reason this guard exists. So the
 * failure is carried to teardown, when the terminal is free again, and reported once there.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { installStderrGuard } from '../../src/terminal-io/stderr-guard.js'

let dir: string
let realWrite: typeof process.stderr.write

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theocode-guard-'))
  realWrite = process.stderr.write
})

afterEach(() => {
  process.stderr.write = realWrite
  rmSync(dir, { recursive: true, force: true })
})

/** Captures what reaches the REAL stderr, i.e. what the user sees after the frame is gone. */
function captureRealStderr(): { seen: string[]; restore: () => void } {
  const seen: string[] = []
  const original = process.stderr.write
  process.stderr.write = ((c: unknown) => {
    seen.push(String(c))
    return true
  }) as typeof process.stderr.write
  return { seen, restore: () => (process.stderr.write = original) }
}

describe('B-039 — a dead diagnostic channel says so', () => {
  it('test_a_writable_log_keeps_the_frame_clean', () => {
    // Anti-vacuity floor: reporting on every teardown would satisfy the assertion below, and it
    // would also mean the guard writes to stderr in the normal case — the thing it exists to stop.
    const cap = captureRealStderr()
    const uninstall = installStderrGuard(join(dir, 'logs', 'tui.log'))
    process.stderr.write('a warning\n')
    uninstall()
    cap.restore()

    expect(cap.seen.join(''), 'the guard leaked a normal diagnostic to the real stderr').toBe('')
  })

  it('test_an_unwritable_log_is_reported_at_teardown', () => {
    // A regular FILE where the log directory must be: every append fails with ENOTDIR.
    writeFileSync(join(dir, 'logs'), 'not a directory')

    const cap = captureRealStderr()
    const uninstall = installStderrGuard(join(dir, 'logs', 'tui.log'))
    process.stderr.write('a warning that matters\n')
    process.stderr.write('and another\n')
    uninstall()
    cap.restore()

    const out = cap.seen.join('')
    expect(out, 'the TUI ran with every diagnostic dead and said nothing about it at exit').toMatch(
      /diagnostic/i,
    )
    expect(out, 'the report did not say how many were lost').toMatch(/2/)
  })
})
