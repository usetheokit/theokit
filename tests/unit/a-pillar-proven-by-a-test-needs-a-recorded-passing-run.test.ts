/**
 * A pillar marked proven counts only with a recorded passing run of a live proof test (B-416).
 *
 * A hand-written "it passed" in the map is a self-report nothing checks. So a `proven` row names a
 * test file under `apps/{theoclaw,theocode}/**\/tests/live/` and the vitest `fullName` of the test,
 * and `scripts/check-pillar-map.mjs` looks for that assertion in the vitest JSON reports passed with
 * `--results`. Only the newest run of the file counts, and only `passed` passes: the one live
 * candidate today calls `ctx.skip()` when no model server answers, and a skip proves nothing.
 *
 * Reports are built here with a fake absolute checkout path, because a report written by CI names
 * files under a checkout path that is not this one. Every fixture lives in an OS temp directory.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SCRIPT = join(ROOT, 'scripts', 'check-pillar-map.mjs')
const NINE_WORDS = 'no proof needs this pillar for the 0.1 release'

const LIVE_FILE = 'apps/theocode/packages/agent/tests/live/one-real-turn.test.ts'
const FULL_NAME =
  'a live turn, through the provider surface the product uses compacts a transcript past its budget, with a LIVE model writing the summary'
const CHECKOUT = '/ci/checkout'

type Row = Record<string, unknown>
interface Assertion {
  fullName: string
  status: string
}
interface FileRecord {
  name: string
  startTime: number
  assertionResults: Assertion[]
}

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pillar-proof-'))
  dirs.push(dir)
  return dir
}

function run(args: readonly string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' })
}

function compactionRow(edit: Row = {}): Row {
  return {
    pillar: 'compaction',
    status: 'proven',
    app: 'theocode',
    file: LIVE_FILE,
    fullName: FULL_NAME,
    ...edit,
  }
}

/** 32 out rows with 9-word reasons, plus the compaction row under test. */
function writeMap(dir: string, row: Row = compactionRow()): string {
  const names = run(['--list-pillars']).stdout.split('\n').filter(Boolean)
  const rows = names.map((pillar) =>
    pillar === 'compaction' ? row : { pillar, status: 'out', reason: NINE_WORDS },
  )
  const mapPath = join(dir, 'map.json')
  writeFileSync(mapPath, JSON.stringify({ pillars: rows }))
  return mapPath
}

function record(startTime: number, status: string | null, file = LIVE_FILE): FileRecord {
  return {
    name: `${CHECKOUT}/${file}`,
    startTime,
    assertionResults: status === null ? [] : [{ fullName: FULL_NAME, status }],
  }
}

function writeReport(dir: string, name: string, testResults: unknown): string {
  const reportPath = join(dir, name)
  writeFileSync(reportPath, JSON.stringify({ testResults }))
  return reportPath
}

/** Runs the checker against the default compaction row and one report per entry of `reports`. */
function check(reports: FileRecord[][], row?: Row) {
  const dir = tempDir()
  const args = ['--map', writeMap(dir, row)]
  reports.forEach((records, i) => args.push('--results', writeReport(dir, `r${i}.json`, records)))
  return run(args)
}

describe('a proven row needs a recorded passing run', () => {
  it('fails a proven row when no results file is given', () => {
    const out = check([])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('compaction: no recorded passing run')
  })

  it('fails a proven row whose test was skipped', () => {
    const out = check([[record(1, 'skipped')]])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('compaction: last recorded run is skipped')
  })

  it('fails a proven row whose test failed', () => {
    const out = check([[record(1, 'failed')]])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('compaction: last recorded run is failed')
  })

  it('passes a proven row whose test passed', () => {
    const out = check([[record(1, 'passed')]])

    expect(out.status).toBe(0)
    expect(out.stdout).toContain('33 of 33 pillars proven or out')
  })

  it('fails a passed assertion recorded for a different file with the same fullName', () => {
    const other = 'apps/theocode/packages/agent/tests/live/another-turn.test.ts'
    const out = check([[record(1, 'passed', other)]])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('compaction: no recorded passing run')
  })
})

describe('only the newest run of the file counts', () => {
  it('fails when an older report passed and a newer one failed', () => {
    const out = check([[record(1, 'passed')], [record(2, 'failed')]])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('compaction: last recorded run is failed')
  })

  it('passes when an older report skipped and a newer one passed', () => {
    const out = check([[record(1, 'skipped')], [record(2, 'passed')]])

    expect(out.status).toBe(0)
  })

  it('fails when an older report passed and a newer file result has no assertions', () => {
    const out = check([[record(1, 'passed')], [record(2, null)]])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('newest run of the file has no result for this test')
  })

  it('fails when two records tie on startTime and one lacks the assertion', () => {
    const out = check([[record(2, 'passed')], [record(2, null)]])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('newest run of the file has no result for this test')
  })

  it('fails a passed record whose startTime is not a number', () => {
    const untimed = { ...record(1, 'passed'), startTime: 'yesterday' } as unknown as FileRecord
    const out = check([[untimed]])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('compaction: a recorded run of the file has no start time')
  })

  it('fails when an older run passed and a failed run carries no start time', () => {
    const untimed = { ...record(2, 'failed'), startTime: null } as unknown as FileRecord
    const out = check([[record(1, 'passed')], [untimed]])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('compaction: a recorded run of the file has no start time')
  })

  it('fails when the newest run holds the title twice and one of them failed', () => {
    const twice = record(1, 'passed')
    twice.assertionResults.push({ fullName: FULL_NAME, status: 'failed' })
    const out = check([[twice]])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('compaction: last recorded run is failed')
  })

  it('matches a report written on Windows by its file path', () => {
    const windows = { ...record(1, 'passed'), name: `C:\\ci\\${LIVE_FILE.replaceAll('/', '\\')}` }
    const out = check([[windows]])

    expect(out.status).toBe(0)
  })

  it('fails a row when two reports tie on startTime and one failed', () => {
    const out = check([[record(2, 'passed')], [record(2, 'failed')]])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('compaction: last recorded run is failed')
  })
})

describe('a proven row names a live proof test that exists and declares the title', () => {
  it('fails a proven row whose file sits under packages/', () => {
    const out = check([], compactionRow({ file: 'packages/agents/tests/live/turn.test.ts' }))

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('file must sit under apps/theoclaw or apps/theocode')
  })

  it('fails a proven row whose file does not exist', () => {
    const out = check([], compactionRow({ file: 'apps/theocode/tests/live/absent.test.ts' }))

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('compaction: file does not exist')
  })

  it('fails a path that escapes tests/live with ..', () => {
    const escaping = 'apps/theocode/tests/live/../../../packages/agents/tests/x.test.ts'
    const out = check([], compactionRow({ file: escaping }))

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('file must sit under apps/theoclaw or apps/theocode')
  })

  it('fails an absolute path and a path with a ./ segment', () => {
    const absolute = check([], compactionRow({ file: `/${LIVE_FILE}` }))
    const dotted = check([], compactionRow({ file: LIVE_FILE.replace('/tests/', '/./tests/') }))

    expect(absolute.stdout).toContain('file must sit under apps/theoclaw or apps/theocode')
    expect(dotted.stdout).toContain('file must sit under apps/theoclaw or apps/theocode')
  })

  it('fails a fullName whose title the file does not declare', () => {
    const fullName = 'a live turn, through the provider surface the product uses flies to the moon'
    const out = check([], compactionRow({ fullName }))

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('compaction: title not found in file')
  })

  it('fails a proven row whose app disagrees with its file', () => {
    const out = check([[record(1, 'passed')]], compactionRow({ app: 'theoclaw' }))

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('app "theoclaw" does not match file')
  })
})

describe('a results file the check cannot read exits 2', () => {
  it('exits 2 on a results file that is not a vitest report', () => {
    const dir = tempDir()
    const reportPath = join(dir, 'foo.json')
    writeFileSync(reportPath, '{"foo":1}')
    const out = run(['--map', writeMap(dir), '--results', reportPath])

    expect(out.status).toBe(2)
    expect(out.stderr).toContain(reportPath)
  })

  it('exits 2 on a report record with no file name', () => {
    const dir = tempDir()
    const nameless = { ...record(2, 'failed'), name: null }
    const reportPath = writeReport(dir, 'nameless.json', [record(1, 'passed'), nameless])
    const out = run(['--map', writeMap(dir), '--results', reportPath])

    expect(out.status).toBe(2)
    expect(out.stderr).toContain('testResults[1] has no file name')
  })

  it('exits 2 when --results has no path', () => {
    const dir = tempDir()
    const out = run(['--map', writeMap(dir), '--results'])

    expect(out.status).toBe(2)
    expect(out.stderr).toContain('--results needs a path')
  })
})

describe('the check stays fast on a large report', () => {
  it('checks 33 rows against a 5 MB report in under 5000 ms', () => {
    const dir = tempDir()
    const filler: FileRecord[] = []
    for (let i = 0; i < 40_000; i++) {
      filler.push(record(1, 'passed', `apps/theocode/tests/live/filler-${i}.test.ts`))
    }
    filler.push(record(2, 'passed'))
    const reportPath = writeReport(dir, 'big.json', filler)
    const mapPath = writeMap(dir)

    const started = performance.now()
    const out = run(['--map', mapPath, '--results', reportPath])
    const elapsedMs = performance.now() - started

    expect(JSON.stringify({ testResults: filler }).length).toBeGreaterThanOrEqual(5_000_000)
    expect(out.status).toBe(0)
    expect(elapsedMs).toBeLessThan(5000)
  })
})
