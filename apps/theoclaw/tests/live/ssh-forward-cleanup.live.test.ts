import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { findBinary, openSshForward, type SpawnRecord, SshHarnessError } from './support/ssh-forward.js'

/**
 * EC-1 and EC-2 of B-512's harness, kept out of `remote-access.live.test.ts` so the thirteen tests
 * the brief counts stay thirteen. EC-1 runs a real failing test in a child vitest and reads, from
 * that run's next test, whether the `afterEach` killed both children. EC-2 maps `ssh` to
 * `/bin/false` and asserts the setup rolls back at once. Runs only with THEOCLAW_LIVE=1.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url))
const FIXTURE_RUN_MS = 45_000

const scratch: string[] = []

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(dir)
  return dir
}

/** The `code` of the error `process.kill(pid, 0)` throws, or `ALIVE` when it does not throw. */
function signalZeroErrorCode(pid: number): string {
  try {
    process.kill(pid, 0)
    return 'ALIVE'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? String(error)
  }
}

interface FixtureRun {
  readonly exitCode: number | null
  readonly report: { readonly numFailedTests: number; readonly numPassedTests: number }
  readonly resultFile: string
}

/** Run the fixture in a child vitest with its own config and wait for that process to close. */
async function runFixture(): Promise<FixtureRun> {
  const dir = scratchDir('theoclaw-fixture-')
  const reportFile = join(dir, 'report.json')
  const resultFile = join(dir, 'result.json')
  const vitestBin = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs')
  const child = spawn(
    process.execPath,
    [vitestBin, 'run', '--config', 'tests/live/fixtures/vitest.fixture.config.ts', '--reporter=json', `--outputFile=${reportFile}`],
    {
      cwd: APP_DIR,
      env: { ...process.env, THEOCLAW_LIVE: '1', FIXTURE_PIDS_FILE: join(dir, 'pids.json'), FIXTURE_RESULT_FILE: resultFile },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: AbortSignal.timeout(FIXTURE_RUN_MS),
    },
  )
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', (error) => reject(new Error(`the fixture run failed within ${FIXTURE_RUN_MS} ms: ${error.message}: ${output}`)))
    child.once('close', (code) => resolve(code))
  })
  if (!existsSync(reportFile)) throw new Error(`the fixture run wrote no report (exit ${exitCode}): ${output}`)
  const report = JSON.parse(readFileSync(reportFile, 'utf8')) as FixtureRun['report']
  return { exitCode, report, resultFile }
}

describe.skipIf(!LIVE)('the SSH harness cleans up after a failure', () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

  afterAll(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  it('kills sshd and ssh when the test fails before close', async () => {
    const run = await runFixture()
    expect(run.exitCode).toBe(1)
    expect(run.report.numFailedTests).toBe(1)
    expect(run.report.numPassedTests).toBe(1)
    const codes = JSON.parse(readFileSync(run.resultFile, 'utf8')) as string[]
    expect(codes).toEqual(['ESRCH', 'ESRCH'])
  })

  it('rolls back at once when ssh exits during setup', async () => {
    const binDir = scratchDir('theoclaw-bin-')
    for (const name of ['sshd', 'ssh-keygen']) symlinkSync(findBinary(name), join(binDir, name))
    symlinkSync('/bin/false', join(binDir, 'ssh'))
    const spawned: SpawnRecord[] = []
    const err: unknown = await openSshForward({ targetPort: 1, binDir, onSpawn: (record) => spawned.push(record) }).catch(
      (error: unknown) => error,
    )
    const rejectedAt = Date.now()
    expect(err).toBeInstanceOf(SshHarnessError)
    expect((err as Error).message).toMatch(/exit code 1/)
    const sshRecord = spawned.find((record) => record.name === 'ssh')
    expect(sshRecord).toBeDefined()
    expect(rejectedAt - sshRecord!.spawnedAt).toBeLessThan(3000)
    const sshdRecord = spawned.find((record) => record.name === 'sshd')
    expect(sshdRecord).toBeDefined()
    expect(signalZeroErrorCode(sshdRecord!.pid)).toBe('ESRCH')
    expect(existsSync(sshdRecord!.tempDir)).toBe(false)
  })
})
