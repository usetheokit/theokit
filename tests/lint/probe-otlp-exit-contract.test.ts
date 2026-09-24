/**
 * The probe's `--ingest` is user input at a CLI boundary, and its diagnostics are the whole product:
 * this script exists to say what it could NOT measure, so a message naming the wrong cause is the
 * failure it was written to prevent.
 *
 * Driven as a subprocess because the module runs the whole probe at import — there is no exported
 * surface to call. That is a known limitation, filed as B-294; these cases exercise what can be
 * exercised through the only interface the script has.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

/** Runs the probe with `args` and returns its exit code and stderr, never throwing on non-zero. */
async function probe(args: string[]): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await run('npx', ['tsx', 'scripts/probe-otlp-delivery.ts', ...args], {
      cwd: process.cwd(),
      timeout: 120_000,
    })
    return { code: 0, stderr }
  } catch (error) {
    const e = error as { code?: number; stderr?: string }
    return { code: e.code ?? -1, stderr: e.stderr ?? '' }
  }
}

describe('probe-otlp-delivery exit contract', () => {
  // A missing scheme is the likeliest typo. Before this case the probe answered it with the guard's
  // own message — "answers below 400 … on a path it does not serve" — sending the reader to debug a
  // collector when the fault is in their flag. Exit 2 was right; the sentence was not.
  it('names the flag, not the collector, when --ingest is not a URL', async () => {
    const { code, stderr } = await probe(['--ingest', '127.0.0.1:4318/v1/traces'])
    expect(code).toBe(2)
    expect(stderr).toContain('--ingest')
    expect(stderr).toContain('NOT MEASURED')
    expect(stderr).not.toContain('answers below 400')
  }, 130_000)
})
