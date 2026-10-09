#!/usr/bin/env node
/**
 * Count the OBJ-8 pillars that are proven or declared out, and fail every other one (B-416).
 *
 * ## Why this exists
 *
 * OBJ-8 asks for 33 of 33 framework pillars exercised end to end by TheoClaw or TheoCode on a real
 * model run, or declared out with the reason written. Until this check the 33 names lived in one
 * prose sentence of `.squad/wiki/product/objectives.md` and nothing mapped a pillar to a test, so
 * the count could only be made by eye. `docs/program/pillar-map.json` holds one row per pillar and
 * this script refuses each row that does not answer for its pillar.
 *
 * ## Row states
 *
 * - `out`: counted, with a `reason` of 8 words or more.
 * - `pending`: always fails.
 * - `proven`: names `app`, a test `file` in a `tests/live/` directory of `apps/theoclaw` or
 *   `apps/theocode`, and the vitest `fullName` of the test. It counts only when the newest run of
 *   that file, in the vitest JSON reports passed with `--results`, records the assertion as
 *   `passed`. A skip is not a pass: the live tests skip when no model server answers. Titles are
 *   read from the source as written, so three shapes are never found and their rows fail closed:
 *   a template literal with `${`, a literal holding an escape sequence (`'doesn\'t'` is read with
 *   its backslash while vitest reports `doesn't`), and an `it.each(...)` title.
 *
 * ## Exit codes
 *
 * 0 when all 33 pillars pass, 1 when at least one fails (one line per failing pillar, then
 * `<N> of 33 pillars not proven`, followed by `, <K> rows name no pillar` when K rows are unknown or
 * have no string `pillar`), 2 when an input cannot be read or has the wrong shape. An
 * unexpected error is 2 as well: Node's default of 1 would read as "pillars failing" when the truth
 * is that nothing was checked.
 *
 * ## Paths
 *
 * `--map` and `--results` resolve against the process's working directory. Under
 * `pnpm check:pillars` that is the repository root, not the directory pnpm was called from, so a
 * report written under `apps/theocode` is passed as `--results apps/theocode/<report>.json`. A
 * path that resolves to nothing is exit 2 and names the absolute path it tried.
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, posix, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DEFAULT_MAP = resolve(ROOT, 'docs/program/pillar-map.json')
const MIN_REASON_WORDS = 8

/** Copied verbatim from `.squad/wiki/product/objectives.md` (OBJ-8); a test holds them in step. */
const PILLARS = [
  'agents',
  'file-based config',
  'providers and models',
  'prompts',
  'reasoning',
  'tools',
  'streaming',
  'workflows',
  'squad',
  'memory',
  'sessions',
  'context',
  'compaction',
  'structured output',
  'goals',
  'tasks',
  'subagents',
  'A2A',
  'handoffs',
  'guardrails',
  'permissions',
  'resilience',
  'hooks',
  'schedules',
  'cache',
  'personalities',
  'evals',
  'cost',
  'observability',
  'MCP',
  'sandbox',
  'filesystem',
  'ACP server',
]

/** An input the check could not read. Mapped to exit 2, never to a failing pillar. */
class UnreadableInput extends Error {}

function parseArgs(argv) {
  const args = { map: DEFAULT_MAP, results: [], listPillars: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--list-pillars') args.listPillars = true
    else if (arg === '--map' || arg === '--results') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) {
        throw new UnreadableInput(`${arg} needs a path`)
      }
      if (arg === '--map') args.map = resolve(value)
      else args.results.push(resolve(value))
    } else throw new UnreadableInput(`unknown argument ${arg}`)
  }
  return args
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new UnreadableInput(`cannot read ${path}: ${err.message}`)
  }
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** `apps/<app>/.../tests/live/<name>.test.ts(x)`: where a live proof test lives (D6). */
const LIVE_PROOF_PATH = /^apps\/(theoclaw|theocode)\/(.+\/)?tests\/live\/[^/]+\.test\.tsx?$/

/**
 * Test titles declared with a literal: `it('...')`, `test.skip("...")`, `it.concurrent(`...`)`. A
 * template literal with `${` is not a fixed title and is not returned, so its row fails closed.
 */
const TITLE = /\b(?:it|test)(?:\.(?:skip|only|concurrent))*\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*?)\1/g

function isLiveProofPath(file) {
  return (
    typeof file === 'string' &&
    !isAbsolute(file) &&
    !file.split('/').includes('..') &&
    posix.normalize(file) === file &&
    LIVE_PROOF_PATH.test(file)
  )
}

function extractTitles(source) {
  return [...source.matchAll(TITLE)].map((m) => m[2]).filter((title) => !title.includes('${'))
}

/** Every file record of every report, read once. */
function loadReports(paths) {
  return paths.flatMap((path) => {
    const report = loadJson(path)
    if (!Array.isArray(report?.testResults)) {
      throw new UnreadableInput(`cannot read ${path}: "testResults" is not an array`)
    }
    // A record with no file name cannot be matched to any row, so skipping it could hide a newer
    // failed run. The report is malformed, which is exit 2, not a row that silently passes.
    const unnamed = report.testResults.findIndex((record) => typeof record?.name !== 'string')
    if (unnamed !== -1) {
      throw new UnreadableInput(`cannot read ${path}: testResults[${unnamed}] has no file name`)
    }
    return report.testResults
  })
}

/**
 * The newest run of the row's file decides (D1): the file records are selected FIRST, by the
 * largest `startTime`, and only then searched for the assertion, so a newer run that failed to
 * collect outranks an older pass. Every record tied on that time must hold the passed assertion.
 */
function newestRunProblem(row, records) {
  const ofFile = records.filter((record) =>
    record.name.replaceAll('\\', '/').endsWith(`/${row.file}`),
  )
  if (ofFile.length === 0) return 'no recorded passing run'
  // A run with no numeric time cannot be ordered against the others, so nobody can say it is not
  // the newest. Failing the row is the only answer that does not guess.
  if (ofFile.some((record) => !Number.isFinite(record.startTime))) {
    return 'a recorded run of the file has no start time'
  }
  const newest = ofFile.reduce((max, record) => Math.max(max, record.startTime), -Infinity)
  for (const record of ofFile.filter((r) => r.startTime === newest)) {
    const assertions = Array.isArray(record.assertionResults) ? record.assertionResults : []
    // vitest accepts two tests with the same title; every one of them must have passed.
    const matching = assertions.filter((a) => a?.fullName === row.fullName)
    if (matching.length === 0) return 'newest run of the file has no result for this test'
    const notPassed = matching.find((a) => a.status !== 'passed')
    if (notPassed) return `last recorded run is ${notPassed.status}`
  }
  return null
}

function provenRowProblem(row, records) {
  if (!isLiveProofPath(row.file)) {
    return 'file must sit under apps/theoclaw or apps/theocode in a tests/live directory'
  }
  if (row.app !== row.file.split('/')[1]) {
    return `app ${JSON.stringify(row.app)} does not match file`
  }
  const absolute = resolve(ROOT, row.file)
  if (!existsSync(absolute)) return 'file does not exist'
  const titles = extractTitles(readFileSync(absolute, 'utf8'))
  const fullName = typeof row.fullName === 'string' ? row.fullName : ''
  if (!titles.some((t) => fullName === t || fullName.endsWith(` ${t}`))) {
    return 'title not found in file'
  }
  return newestRunProblem(row, records)
}

/** The reason a single row does not answer for its pillar, or null when it does. */
function rowProblem(row, records) {
  if (row.status === 'pending') return 'pending'
  if (row.status === 'out') {
    if (typeof row.reason !== 'string') return 'out row has no reason'
    const words = wordCount(row.reason)
    return words >= MIN_REASON_WORDS ? null : `reason has ${words} words, needs ${MIN_REASON_WORDS}`
  }
  if (row.status === 'proven') return provenRowProblem(row, records)
  return `unknown status ${JSON.stringify(row.status)}`
}

/**
 * Returns `{ lines, failing, strays }`: one line per failing pillar or stray row, the count of failing
 * pillars, and the count of rows that name no pillar.
 */
function checkRows(rows, records) {
  const byName = new Map()
  const unknown = []
  rows.forEach((row, index) => {
    const name = row?.pillar
    if (typeof name !== 'string') unknown.push(`row ${index}: pillar is not a string`)
    else if (!PILLARS.includes(name)) unknown.push(`${name}: unknown pillar "${name}"`)
    else byName.set(name, [...(byName.get(name) ?? []), row])
  })

  const lines = []
  for (const name of PILLARS) {
    const list = byName.get(name) ?? []
    let problem
    if (list.length === 0) problem = 'no row'
    else if (list.length > 1) problem = `${list.length} rows`
    else problem = rowProblem(list[0], records)
    if (problem) lines.push(`${name}: ${problem}`)
  }
  return { lines: [...lines, ...unknown], failing: lines.length, strays: unknown.length }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.listPillars) {
    console.log(PILLARS.join('\n'))
    return 0
  }

  const map = loadJson(args.map)
  if (!Array.isArray(map?.pillars)) {
    throw new UnreadableInput(`cannot read ${args.map}: "pillars" is not an array`)
  }
  const records = loadReports(args.results)

  const { lines, failing, strays } = checkRows(map.pillars, records)
  for (const line of lines) console.log(line)
  if (lines.length === 0) {
    console.log(`${PILLARS.length} of ${PILLARS.length} pillars proven or out`)
    return 0
  }
  // A row naming no pillar fails the map without failing a pillar, so the count says so: a bare
  // "0 of 33 pillars not proven" beside exit 1 would contradict itself.
  const rowsName = strays === 1 ? 'row names' : 'rows name'
  const stray = strays === 0 ? '' : `, ${strays} ${rowsName} no pillar`
  console.log(`${failing} of ${PILLARS.length} pillars not proven${stray}`)
  return 1
}

try {
  process.exitCode = main()
} catch (err) {
  // No known input reaches the second branch: every malformed input is turned into an
  // UnreadableInput where it is read. It stays so that a defect in this script reads as exit 2,
  // "nothing was checked", and never as Node's default exit 1, "pillars failing".
  const message = err instanceof UnreadableInput ? err.message : `unexpected error: ${err.stack}`
  console.error(`check-pillar-map: ${message}`)
  console.error('  Nothing was checked. This is not a pass.')
  process.exitCode = 2
}
