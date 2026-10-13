/**
 * B-409 — `run-reflective-loop.ts` stays at or under the 601 lines its plan allows (T2.1).
 *
 * The review of 2026-10-09 (finding F-xval-4) measured the file at 611 lines, past the limit,
 * after the max-cost-usd work added its checks inline. fc02e0b9 moved them to `run-budget.ts`
 * and brought the file back to 547. Nothing kept it there: the limit lived only in the plan, so
 * the next inline addition would pass every test. This test is that guard.
 *
 * `THEOKIT_LOOP_FILE_UNDER_TEST` points the check at another file. It exists so the failure can be
 * shown against an over-limit copy without editing the real source.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const LINE_LIMIT = 601

const loopFile =
  process.env.THEOKIT_LOOP_FILE_UNDER_TEST ??
  fileURLToPath(new URL('../../src/loop/run-reflective-loop.ts', import.meta.url))

function countLines(path: string): number {
  const text = readFileSync(path, 'utf8')
  // `wc -l` counts newline characters; a file ending without one still has its last line.
  const newlines = text.split('\n').length - 1
  return text.endsWith('\n') ? newlines : newlines + 1
}

describe('run-reflective-loop.ts size', () => {
  it('test_the_reflective_loop_file_stays_at_or_under_601_lines', () => {
    expect(countLines(loopFile)).toBeLessThanOrEqual(LINE_LIMIT)
  })
})
