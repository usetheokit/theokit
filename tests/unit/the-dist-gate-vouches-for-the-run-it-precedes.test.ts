import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FRESH_WINDOW_MS } from '../integration/_helpers/build-theokit-package.js'

/**
 * B-700 — the dist gate's decision does not reach the vitest run that follows it.
 *
 * `pnpm test` is `pnpm test:dist-gate && vitest run`. The gate (`scripts/ensure-theo-dist.ts`) calls
 * `buildTheokitPackageOnce()`, which records "dist validated" under `runId() = process.ppid`. The
 * gate's parent is the shell pnpm started for the gate script; a vitest worker's parent is the vitest
 * main process. The two never match, so the first worker to reach the helper decides AGAIN by the
 * ten-minute mtime window. Measured 2026-11-02 on one `pnpm test`: the marker read `{"runId":37045}`
 * after the gate and `{"runId":37107}` (the vitest main pid) 47 s into the run.
 *
 * When the window lapses between the gate and that first worker, the worker rebuilds
 * `packages/theo/dist` with tsup `clean: true` while the rest of the parallel `root` project reads it.
 *
 * This test reproduces the process shape of `pnpm test`: one shell exports `THEOKIT_TEST_RUN_ID`
 * (the contract the `test` script carries, decided in the B-700 alignment), runs a gate process,
 * then a "vitest main" process that forks a "worker". The dist is past the window, the gate
 * validated it, and the worker must not decide to rebuild.
 */
const HELPER = resolve(__dirname, '../integration/_helpers/build-theokit-package.ts')

let sandbox: string

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'theo-dist-gate-run-'))
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('the dist gate and the run it precedes', () => {
  it('test_a_worker_of_the_run_trusts_the_dist_the_gate_validated_just_before_it', () => {
    const marker = join(sandbox, 'validated.json')
    const distTypes = join(sandbox, 'index.d.ts')
    writeFileSync(distTypes, 'export {}\n', 'utf8')
    const pastTheWindow = (Date.now() - FRESH_WINDOW_MS - 60_000) / 1000
    utimesSync(distTypes, pastTheWindow, pastTheWindow)

    const gate = join(sandbox, 'gate.mts')
    writeFileSync(
      gate,
      `import { markDistValidatedForThisRun } from ${JSON.stringify(HELPER)}\n` +
        `markDistValidatedForThisRun(${JSON.stringify(marker)})\n`,
    )
    const worker = join(sandbox, 'worker.mts')
    writeFileSync(
      worker,
      `import { isDistUsableWithoutRebuilding } from ${JSON.stringify(HELPER)}\n` +
        `process.stdout.write(String(isDistUsableWithoutRebuilding(${JSON.stringify(marker)}, ${JSON.stringify(distTypes)})))\n`,
    )
    const main = join(sandbox, 'main.mjs')
    writeFileSync(
      main,
      `import { fork } from 'node:child_process'\n` +
        `fork(${JSON.stringify(worker)}, { execArgv: ['--import', 'tsx'] })\n`,
    )

    const tsx = resolve(__dirname, '../../node_modules/.bin/tsx')
    const out = execFileSync(
      '/bin/sh',
      ['-c', `export THEOKIT_TEST_RUN_ID=$$; "${tsx}" "${gate}" && node --import tsx "${main}"`],
      { cwd: resolve(__dirname, '../..'), encoding: 'utf8', timeout: 60_000 },
    )

    expect(
      out.trim(),
      'the worker re-decided by the clock: the gate validated dist under a run id no worker shares',
    ).toBe('true')
  })
})
