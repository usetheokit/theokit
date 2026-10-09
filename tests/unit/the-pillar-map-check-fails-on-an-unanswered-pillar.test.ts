/**
 * The pillar map check refuses every pillar that is neither proven nor declared out (B-416).
 *
 * OBJ-8 counts 33 framework pillars, and until this check existed the count could only be made by
 * eye: the names lived in one prose sentence of the objective and nothing mapped a pillar to the
 * proof test that exercises it. `scripts/check-pillar-map.mjs` reads `docs/program/pillar-map.json`
 * and fails each pillar that is pending, missing, duplicated, unknown, or declared out with a
 * reason too short to be one.
 *
 * Every fixture map is written to an OS temp directory, never into the repository.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SCRIPT = join(ROOT, 'scripts', 'check-pillar-map.mjs')
const NINE_WORDS = 'no proof needs this pillar for the 0.1 release'

type Row = Record<string, unknown>

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function run(args: readonly string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' })
}

/** The 33 canonical names, as the checker itself prints them. Empty while the checker is absent. */
const PILLARS = run(['--list-pillars']).stdout.split('\n').filter(Boolean)

/** Writes `content` as the map file of a fresh temp directory and returns its path. */
function writeMap(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pillar-map-'))
  dirs.push(dir)
  const mapPath = join(dir, 'map.json')
  writeFileSync(mapPath, content)
  return mapPath
}

/** A map where every pillar is out with a 9-word reason, then `edit` applied to the rows. */
function mapWith(edit: (rows: Row[]) => Row[] = (rows) => rows): string {
  const rows: Row[] = PILLARS.map((pillar) => ({ pillar, status: 'out', reason: NINE_WORDS }))
  return writeMap(JSON.stringify({ pillars: edit(rows) }))
}

function replace(rows: Row[], name: string, row: Row): Row[] {
  return rows.map((r) => (r.pillar === name ? row : r))
}

describe('a pillar that is neither proven nor out fails the check', () => {
  it('fails a pending row and names it', () => {
    const out = run([
      '--map',
      mapWith((rows) => replace(rows, 'memory', { pillar: 'memory', status: 'pending' })),
    ])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('memory: pending')
    expect(out.stdout).toContain('1 of 33 pillars not proven')
  })

  it('fails a map of 32 rows and names the missing pillar', () => {
    const out = run(['--map', mapWith((rows) => rows.filter((r) => r.pillar !== 'sandbox'))])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('sandbox: no row')
  })

  it('fails a pillar listed twice', () => {
    const out = run([
      '--map',
      mapWith((rows) => [...rows, { pillar: 'hooks', status: 'out', reason: NINE_WORDS }]),
    ])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('hooks: 2 rows')
  })

  it('fails a row naming a pillar outside the 33', () => {
    const out = run([
      '--map',
      mapWith((rows) => [...rows, { pillar: 'telepathy', status: 'out', reason: NINE_WORDS }]),
    ])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('unknown pillar "telepathy"')
  })

  it('counts a row naming no pillar in the summary line instead of reporting 0 failures', () => {
    const out = run([
      '--map',
      mapWith((rows) => [...rows, { pillar: 'telepathy', status: 'out', reason: NINE_WORDS }]),
    ])

    expect(out.status).toBe(1)
    expect(out.stdout).toMatch(/^0 of 33 pillars not proven, 1 row names no pillar$/m)
  })

  it('counts every row naming no pillar, string or not, in the summary line', () => {
    const out = run([
      '--map',
      mapWith((rows) => [
        ...replace(rows, 'memory', { pillar: 'memory', status: 'pending' }),
        { pillar: 'telepathy', status: 'pending' },
        { pillar: 7, status: 'out' },
      ]),
    ])

    expect(out.status).toBe(1)
    expect(out.stdout).toMatch(/^1 of 33 pillars not proven, 2 rows name no pillar$/m)
  })

  it('fails a row whose pillar is not a string and names it by index', () => {
    const out = run(['--map', mapWith((rows) => [...rows, { pillar: 7, status: 'out' }])])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('row 33: pillar is not a string')
  })

  it('fails a row whose status is not one of the three states', () => {
    const out = run([
      '--map',
      mapWith((rows) => replace(rows, 'cache', { pillar: 'cache', status: 'maybe' })),
    ])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('cache: unknown status "maybe"')
  })
})

describe('an out row needs a reason of 8 words or more', () => {
  it('fails an out row whose reason has 3 words', () => {
    const out = run([
      '--map',
      mapWith((rows) =>
        replace(rows, 'cost', { pillar: 'cost', status: 'out', reason: 'not needed now' }),
      ),
    ])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('cost: reason has 3 words, needs 8')
  })

  it('passes an out row whose reason has 9 words', () => {
    const out = run(['--map', mapWith()])

    expect(out.status).toBe(0)
    expect(out.stdout).toContain('33 of 33 pillars proven or out')
  })

  it('fails, not crashes, on an out row whose reason is a number', () => {
    const out = run([
      '--map',
      mapWith((rows) => replace(rows, 'cost', { pillar: 'cost', status: 'out', reason: 42 })),
    ])

    expect(out.status).toBe(1)
    expect(out.stdout).toContain('cost: out row has no reason')
  })
})

describe('an input the check cannot read exits 2, never 1', () => {
  it('exits 2 on an unparseable map and prints its path', () => {
    const mapPath = writeMap('{ not json')
    const out = run(['--map', mapPath])

    expect(out.status).toBe(2)
    expect(out.stderr).toContain(mapPath)
  })

  it('exits 2 on a map that does not exist and prints its path', () => {
    const out = run(['--map', '/nonexistent.json'])

    expect(out.status).toBe(2)
    expect(out.stderr).toContain('/nonexistent.json')
  })

  it('exits 2 on an argument it does not know', () => {
    const out = run(['--maps', mapWith()])

    expect(out.status).toBe(2)
    expect(out.stderr).toContain('unknown argument --maps')
  })

  it('exits 2 when --map is followed by another flag instead of a path', () => {
    const out = run(['--map', '--list-pillars'])

    expect(out.status).toBe(2)
    expect(out.stderr).toContain('--map needs a path')
  })

  it('exits 2 on a results file that does not exist', () => {
    const out = run(['--map', mapWith(), '--results', '/nonexistent-report.json'])

    expect(out.status).toBe(2)
    expect(out.stderr).toContain('/nonexistent-report.json')
  })

  it('exits 2 when pillars is not an array', () => {
    const out = run(['--map', writeMap('{"pillars": {}}')])

    expect(out.status).toBe(2)
  })
})

describe('the canonical names are the objective’s own', () => {
  it('holds 33 unique canonical names, each present in the objective', () => {
    const names = PILLARS
    const objective = readFileSync(join(ROOT, '.squad/wiki/product/objectives.md'), 'utf8')
    // The objective lists the pillars once, in parentheses after "pillar by pillar". Comparing
    // against that list, not a substring search, catches a truncated name ("agent" is inside
    // "agents") as well as a renamed one.
    const listed = /pillar by pillar\s*\(([^)]*)\)/.exec(objective)?.[1] ?? ''
    const declared = listed.split(',').map((name) => name.replace(/\s+/g, ' ').trim())

    expect(listed, 'the objective no longer lists the pillars after "pillar by pillar ("').not.toBe(
      '',
    )
    expect(new Set(names).size).toBe(33)
    expect(names).toEqual(declared)
  })
})

describe('the committed map answers for every pillar', () => {
  const COMMITTED_MAP = join(ROOT, 'docs/program/pillar-map.json')
  const SUMMARY = /^\d+ of 33 pillars (not proven|proven or out)$/m

  it('the committed map names every pillar exactly once', () => {
    // Throws, and so fails, while the map is absent.
    const map = JSON.parse(readFileSync(COMMITTED_MAP, 'utf8')) as { pillars: Row[] }
    const out = run([])

    expect(out.status).toBe(map.pillars.every((row) => row.status === 'out') ? 0 : 1)
    expect(out.stdout).toMatch(SUMMARY)
    expect(out.stdout).not.toMatch(/no row|rows$|unknown pillar/m)
  })

  /** The committed rows, read fresh so each test sees the map as it is on disk. */
  function committedRows(): Row[] {
    return (JSON.parse(readFileSync(COMMITTED_MAP, 'utf8')) as { pillars: Row[] }).pillars
  }

  /** What the check must print last when `failing` pillars are not proven. */
  function expectedSummary(failing: number): string {
    return failing === 0 ? '33 of 33 pillars proven or out' : `${failing} of 33 pillars not proven`
  }

  // The map changes state as pillars are proven or declared out, so these assert the invariant
  // derived from the map itself rather than today's count: with no report every row that is not
  // out fails, and with a passing report for every proven row only the pending rows fail.
  it('the committed map fails exactly the rows that are not out when no report is given', () => {
    const failing = committedRows().filter((row) => row.status !== 'out').length
    const out = run([])
    const lines = out.stdout.split('\n').filter((line) => line !== '' && !SUMMARY.test(line))

    expect(out.status).toBe(failing === 0 ? 0 : 1)
    expect(out.stdout.trimEnd().split('\n').at(-1)).toBe(expectedSummary(failing))
    expect(lines).toHaveLength(failing)
    expect(lines.filter((line) => !/: (pending|no recorded passing run)$/.test(line))).toEqual([])
  })

  it('the committed map fails only its pending rows once every proven row has a passing run', () => {
    const rows = committedRows()
    const proven = rows.filter((row) => row.status === 'proven')
    const dir = mkdtempSync(join(tmpdir(), 'pillar-map-'))
    dirs.push(dir)
    const report = join(dir, 'report.json')
    writeFileSync(
      report,
      JSON.stringify({
        testResults: proven.map((row) => ({
          name: `/ci/checkout/${String(row.file)}`,
          startTime: 1,
          assertionResults: [{ fullName: row.fullName, status: 'passed' }],
        })),
      }),
    )
    const failing = rows.filter((row) => row.status === 'pending').length
    const out = run(['--results', report])

    expect(out.status).toBe(failing === 0 ? 0 : 1)
    expect(out.stdout.trimEnd().split('\n').at(-1)).toBe(expectedSummary(failing))
  })

  it('the root package exposes check:pillars', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(pkg.scripts['check:pillars']).toBe('node scripts/check-pillar-map.mjs')
  })
})
