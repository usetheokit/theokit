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
 * - `proven`: fails until a recorded passing run is found for it.
 *
 * ## Exit codes
 *
 * 0 when all 33 pillars pass, 1 when at least one fails (one line per failing pillar, then
 * `<N> of 33 pillars not proven`), 2 when an input cannot be read or has the wrong shape. An
 * unexpected error is 2 as well: Node's default of 1 would read as "pillars failing" when the truth
 * is that nothing was checked.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

/** The reason a single row does not answer for its pillar, or null when it does. */
function rowProblem(row) {
  if (row.status === 'pending') return 'pending'
  if (row.status === 'out') {
    if (typeof row.reason !== 'string') return 'out row has no reason'
    const words = wordCount(row.reason)
    return words >= MIN_REASON_WORDS ? null : `reason has ${words} words, needs ${MIN_REASON_WORDS}`
  }
  if (row.status === 'proven') return 'no recorded passing run'
  return `unknown status ${JSON.stringify(row.status)}`
}

/** Returns `{ lines, failing }`: one line per failing pillar, and the count of failing pillars. */
function checkRows(rows) {
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
    else problem = rowProblem(list[0])
    if (problem) lines.push(`${name}: ${problem}`)
  }
  return { lines: [...lines, ...unknown], failing: lines.length }
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
  for (const path of args.results) loadJson(path)

  const { lines, failing } = checkRows(map.pillars)
  for (const line of lines) console.log(line)
  if (lines.length === 0) {
    console.log(`${PILLARS.length} of ${PILLARS.length} pillars proven or out`)
    return 0
  }
  console.log(`${failing} of ${PILLARS.length} pillars not proven`)
  return 1
}

try {
  process.exitCode = main()
} catch (err) {
  const message = err instanceof UnreadableInput ? err.message : `unexpected error: ${err.stack}`
  console.error(`check-pillar-map: ${message}`)
  console.error('  Nothing was checked. This is not a pass.')
  process.exitCode = 2
}
