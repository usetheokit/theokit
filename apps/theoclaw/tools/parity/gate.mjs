/**
 * `parity:gate` (#1591): an item that becomes `shipped`, or a `shipped` item whose named files
 * change, needs a `results/<id>.json` with verdict `works` dated after the last commit touching
 * those files. `--all` checks every `shipped` item and only reports.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, RESULTS_DIR } from './harness.mjs'

const REPO_ROOT = join(APP_DIR, '..', '..')
export const LEDGER_REPO_PATH = 'apps/theoclaw/parity/ledger.json'

/** The files an item names: `files` when set, else its check's path. */
export function namedFiles(entry) {
  return [...(Array.isArray(entry.files) ? entry.files : []), ...(entry.check?.path ? [entry.check.path] : [])]
}

/**
 * Returns the unmeasured items. `ledger` and `baseLedger` are parsed arrays (`baseLedger` undefined
 * = check everything); `changed` is the set of files the change touches; `lastChange(files)` is the
 * ISO date of the last change to them; `readResult(id)` the parsed result or undefined.
 */
export function gate({ ledger, baseLedger, changed, lastChange, readResult }) {
  const baseShipped = new Set((baseLedger ?? []).filter((e) => e.status === 'shipped').map((e) => e.id))
  const problems = []
  for (const entry of ledger.filter((e) => e.status === 'shipped')) {
    const files = namedFiles(entry)
    const touched = baseLedger === undefined || !baseShipped.has(entry.id) || files.some((f) => changed.has(f))
    if (!touched) continue
    const result = readResult(entry.id)
    if (result === undefined) problems.push({ id: entry.id, why: 'no results/' + entry.id + '.json' })
    else if (result.verdict !== 'works') problems.push({ id: entry.id, why: `verdict is ${result.verdict}, not works` })
    else {
      const since = lastChange(files)
      // NaN-safe: an unparsable date must count as a problem, so `<=` would not be equivalent.
      // eslint-disable-next-line sonarjs/no-inverted-boolean-check
      if (!(Date.parse(result.date) > Date.parse(since))) problems.push({ id: entry.id, why: `result dated ${result.date} is not after the last change (${since})` })
    }
  }
  return problems
}

function git(args) {
  // From the repository root: the ledger's paths and `git diff --name-only` are root-relative.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- developer tool; git is looked up on the caller's PATH
  const out = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  return out.status === 0 ? out.stdout.replace(/\n$/, '') : undefined
}

function baseRef(argv, env) {
  const at = argv.indexOf('--base')
  if (at >= 0) return argv[at + 1]
  if (env.GITHUB_BASE_REF) return `origin/${env.GITHUB_BASE_REF}`
  return git(['rev-parse', '--verify', 'origin/main']) ? 'origin/main' : 'main'
}

export function runGate(argv, { out = console, env = process.env } = {}) {
  const all = argv.includes('--all')
  const ledger = JSON.parse(readFileSync(join(APP_DIR, 'parity', 'ledger.json'), 'utf8'))
  let baseLedger
  let changed = new Set()
  if (!all) {
    const ref = baseRef(argv, env)
    const baseText = git(['show', `${ref}:${LEDGER_REPO_PATH}`])
    if (baseText === undefined) {
      out.error(`parity:gate: cannot read the ledger at ${ref}; fetch the base branch`)
      return 2
    }
    baseLedger = JSON.parse(baseText)
    const diff = git(['diff', '--name-only', `${ref}...HEAD`]) ?? ''
    const dirty = git(['diff', '--name-only', 'HEAD']) ?? ''
    const untracked = git(['ls-files', '--others', '--exclude-standard']) ?? ''
    changed = new Set([diff, dirty, untracked].flatMap((text) => text.split('\n')).filter(Boolean))
  }
  const lastChange = (files) => {
    const dirty = [git(['diff', '--name-only', 'HEAD', '--', ...files]), git(['ls-files', '--others', '--exclude-standard', '--', ...files])]
    if (dirty.some((text) => text)) return new Date().toISOString()
    return git(['log', '-1', '--format=%cI', 'HEAD', '--', ...files]) ?? '1970-01-01T00:00:00Z'
  }
  const readResult = (id) => {
    const path = join(RESULTS_DIR, `${id}.json`)
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
  }
  const problems = gate({ ledger, baseLedger, changed, lastChange, readResult })
  for (const p of problems) out.log(`unmeasured: ${p.id}: ${p.why}`)
  if (problems.length === 0) {
    out.log('parity:gate: every checked shipped item has a fresh passing result')
    return 0
  }
  if (all) {
    out.log(`parity:gate --all: ${problems.length} shipped items unmeasured`)
    return 0
  }
  out.error(`parity:gate: ${problems.length} shipped item(s) lack a fresh passing result; run pnpm --filter theoclaw parity -- --id <id>`)
  return 1
}
