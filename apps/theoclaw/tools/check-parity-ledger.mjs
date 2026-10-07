#!/usr/bin/env node
/**
 * Counts OBJ-6's 113 parity rows by machine and names every row nobody has answered.
 *
 * B-404. The rows live in two tracked documents: the 106 `| OC-N |` rows of the OpenClaw
 * capability inventory and the 7 rows of the Hermes table in the objectives. The answers live in
 * `apps/theoclaw/parity/ledger.json`. This module reads the documents in place (never a copy of
 * their ids) and requires EXACT counts, so a renamed header or a deleted row is a loud
 * `source-parse` violation instead of a shorter list that passes.
 *
 * Every rule runs on every entry and nothing returns early: one run reports every violation.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const INVENTORY_PATH = '.squad/wiki/references/openclaw-capability-inventory.md'
export const HERMES_PATH = '.squad/wiki/product/objectives.md'
export const LEDGER_PATH = 'apps/theoclaw/parity/ledger.json'

const INVENTORY_FLOOR = 106
const HERMES_FLOOR = 7

/** Ids of the `| OC-N |` rows, in file order. */
export function parseInventoryIds(text) {
  const ids = []
  for (const line of text.split('\n')) {
    const match = /^\|\s*(OC-\d+)\s*\|/.exec(line)
    if (match) ids.push(match[1])
  }
  return ids
}

/**
 * `H-<n>` for each row of the table under the `Hermes' row` header. Scoped to that one table:
 * the objectives carry a later status table whose rows also start with a digit.
 */
export function parseHermesIds(text) {
  const lines = text.split('\n')
  const header = lines.findIndex((line) => /^\|\s*#\s*\|\s*Hermes' row\b/.test(line))
  if (header < 0) return []
  const ids = []
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break
    const match = /^\|\s*(\d+)\s*\|/.exec(line)
    if (match) ids.push(`H-${match[1]}`)
  }
  return ids
}

/** The ledger's entries, or `null` when it cannot be read as an array at all (EC-2). */
function parseLedger(ledgerText, violations, reason = 'absent') {
  if (ledgerText === null) {
    violations.push({ id: LEDGER_PATH, rule: 'ledger-parse', detail: reason })
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(ledgerText)
  } catch (error) {
    violations.push({ id: LEDGER_PATH, rule: 'ledger-parse', detail: error.message })
    return null
  }
  if (!Array.isArray(parsed)) {
    violations.push({ id: LEDGER_PATH, rule: 'ledger-parse', detail: 'the ledger is not a JSON array' })
    return null
  }
  const entries = []
  parsed.forEach((element, index) => {
    if (element !== null && typeof element === 'object' && typeof element.id === 'string') {
      entries.push(element)
    } else {
      violations.push({ id: LEDGER_PATH, rule: 'ledger-parse', detail: `element ${index} has no string id` })
    }
  })
  return entries
}

/** The source's ids when it holds exactly `floor` distinct rows; otherwise `null` and violations (EC-1). */
function readSource(text, parse, floor, path, violations, reason = 'absent') {
  if (text === null) {
    violations.push({ id: path, rule: 'source-parse', detail: reason })
    return null
  }
  const ids = parse(text)
  const distinct = new Set(ids)
  const failed = ids.length !== floor || distinct.size !== floor
  if (failed) {
    violations.push({
      id: path,
      rule: 'source-parse',
      detail: `parsed ${ids.length} of ${floor} rows (${distinct.size} distinct)`,
    })
  }
  for (const id of repeated(ids)) {
    violations.push({ id, rule: 'source-parse', detail: `listed more than once in ${path}` })
  }
  return failed ? null : ids
}

function repeated(ids) {
  const seen = new Set()
  const twice = new Set()
  for (const id of ids) {
    if (seen.has(id)) twice.add(id)
    seen.add(id)
  }
  return [...twice]
}

const HUMAN_DECLARER = /^human\/[A-Za-z0-9][A-Za-z0-9._-]*$/
const MIN_REASON_WORDS = 8

/**
 * True for a real calendar date written `YYYY-MM-DD`. Never throws: `Number.isFinite` is checked
 * before `toISOString`, which throws `RangeError` on `2026-13-01`; the round trip rejects a date
 * JavaScript would normalise, such as `2026-02-30`.
 */
function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

/** EC-5: a blank test name proves nothing, so the file is not read for it. */
const hasTestName = (check) => typeof check.test === 'string' && check.test.trim() !== ''

/** Outside when the relative path is empty, absolute, or its FIRST segment is exactly `..`. */
function leavesRoot(root, target) {
  const rel = relative(root, target)
  return rel === '' || isAbsolute(rel) || rel.split(sep)[0] === '..'
}

/** The violations of the cited test file, or `[]` when it is a regular file inside the root holding the test. */
function judgeCheckFile(id, check, repoRoot) {
  if (typeof check?.path !== 'string') return [{ id, rule: 'check-missing', detail: 'no check.path' }]
  const target = resolve(repoRoot, check.path)
  if (leavesRoot(repoRoot, target)) {
    return [{ id, rule: 'check-outside-repo', detail: check.path }]
  }
  try {
    if (leavesRoot(realpathSync(repoRoot), realpathSync(target))) {
      return [{ id, rule: 'check-outside-repo', detail: `${check.path} resolves outside the repository` }]
    }
    if (!statSync(target).isFile()) return [{ id, rule: 'check-missing', detail: `${check.path} is not a file` }]
    if (!hasTestName(check) || readFileSync(target, 'utf8').includes(check.test)) return []
    return [{ id, rule: 'check-test-absent', detail: `${check.path} does not contain "${check.test}"` }]
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return [{ id, rule: 'check-missing', detail: check.path }]
    }
    return [{ id, rule: 'check-unreadable', detail: `${error.code ?? error.name} on ${JSON.stringify(check.path)}` }]
  }
}

function judgeShipped(entry, repoRoot, today) {
  const { id, check } = entry
  const violations = judgeCheckFile(id, check, repoRoot)
  if (!hasTestName(check ?? {})) violations.push({ id, rule: 'check-test-absent', detail: 'check.test is empty' })
  if (!isIsoDate(entry.verified_on) || entry.verified_on > today) {
    violations.push({ id, rule: 'verified-on', detail: String(entry.verified_on) })
  }
  return violations
}

/** An `out` answer: a reason of 8 words or more, a person as declarer, a real date (no future rule, FR-005). */
function judgeOut(entry) {
  const { id } = entry
  const violations = []
  const words = typeof entry.reason === 'string' ? entry.reason.trim().split(/\s+/).filter(Boolean).length : 0
  if (words < MIN_REASON_WORDS) {
    violations.push({ id, rule: 'reason-short', detail: `${words} words, at least ${MIN_REASON_WORDS} required` })
  }
  if (typeof entry.declared_by !== 'string' || !HUMAN_DECLARER.test(entry.declared_by)) {
    violations.push({ id, rule: 'declarer-not-human', detail: String(entry.declared_by) })
  }
  if (!isIsoDate(entry.declared_on)) violations.push({ id, rule: 'declared-on', detail: String(entry.declared_on) })
  return violations
}

/** The violations of one entry's answer, whatever its id. */
function judgeEntry(entry, repoRoot, today) {
  switch (entry.status) {
    case 'open':
      return [{ id: entry.id, rule: 'open', detail: 'no check and no reason' }]
    case 'shipped':
      return judgeShipped(entry, repoRoot, today)
    case 'out':
      return judgeOut(entry)
    default:
      return [{ id: entry.id, rule: 'unknown-status', detail: String(entry.status) }]
  }
}

/** Caller contract, not ledger content: without them a cited path cannot be resolved and a
 * future verified_on compares false against undefined, so the rule would pass in silence. */
function assertCallerContract(repoRoot, today) {
  if (typeof repoRoot !== 'string' || !isAbsolute(repoRoot)) {
    throw new TypeError(`checkLedger: repoRoot must be an absolute path, got ${JSON.stringify(repoRoot)}`)
  }
  if (!isIsoDate(today)) throw new TypeError(`checkLedger: today must be a YYYY-MM-DD date, got ${JSON.stringify(today)}`)
}

/** Every ledger id answered more than once. */
function judgeDuplicates(entries) {
  return repeated(entries.map((entry) => entry.id)).map((id) => ({
    id,
    rule: 'duplicate',
    detail: 'the ledger answers this row more than once',
  }))
}

/** Every id a readable source declares and the ledger does not answer. */
function judgeMissing(ledgerIds, inventory, hermes) {
  return [...(inventory ?? []), ...(hermes ?? [])]
    .filter((id) => !ledgerIds.has(id))
    .map((id) => ({ id, rule: 'missing', detail: 'no ledger entry' }))
}

/** Every ledger id no source declares; judged only when both sources were read. */
function judgeExtra(ledgerIds, inventory, hermes) {
  if (inventory === null || hermes === null) return []
  const sourceIds = new Set([...inventory, ...hermes])
  return [...ledgerIds]
    .filter((id) => !sourceIds.has(id))
    .map((id) => ({ id, rule: 'extra', detail: 'no source declares this row' }))
}

/** The violations of the ledger's coverage of the two sources: duplicates, then missing, then extra. */
function judgeCoverage(entries, inventory, hermes) {
  const ledgerIds = new Set(entries.map((entry) => entry.id))
  return [
    ...judgeDuplicates(entries),
    ...judgeMissing(ledgerIds, inventory, hermes),
    ...judgeExtra(ledgerIds, inventory, hermes),
  ]
}

/** How many entries carry each known status; an unknown status is counted nowhere. */
function countStatuses(entries) {
  const counts = { shipped: 0, out: 0, open: 0 }
  for (const entry of entries) {
    if (Object.hasOwn(counts, entry.status)) counts[entry.status] += 1
  }
  return counts
}

/**
 * Every violation of the ledger against the two sources, and the counts of its statuses. A `null`
 * text is an input the caller could not read; `reasons` names why (default `absent`).
 */
export function checkLedger({ inventoryText, hermesText, ledgerText, repoRoot, today, reasons = {} }) {
  assertCallerContract(repoRoot, today)
  const violations = []
  const ledger = parseLedger(ledgerText, violations, reasons.ledger)
  const inventory = readSource(
    inventoryText,
    parseInventoryIds,
    INVENTORY_FLOOR,
    INVENTORY_PATH,
    violations,
    reasons.inventory,
  )
  const hermes = readSource(hermesText, parseHermesIds, HERMES_FLOOR, HERMES_PATH, violations, reasons.hermes)
  const entries = ledger ?? []

  if (ledger !== null) violations.push(...judgeCoverage(entries, inventory, hermes))
  for (const entry of entries) violations.push(...judgeEntry(entry, repoRoot, today))

  return { counts: countStatuses(entries), violations }
}

/** The counts line, then `<id> <rule>: <detail>` for each violation. */
export function formatReport({ counts, violations }) {
  return [
    `shipped ${counts.shipped} · out ${counts.out} · open ${counts.open}`,
    ...violations.map((v) => `${v.id} ${v.rule}: ${v.detail}`),
  ]
}

/** `{ text }`, or `{ text: null, reason }` so an input the run cannot read is a violation, never a throw. */
function readInput(path) {
  try {
    return { text: readFileSync(path, 'utf8') }
  } catch (error) {
    return { text: null, reason: error.code === 'ENOENT' ? 'absent' : `unreadable: ${error.code ?? error.name}` }
  }
}

/** Reads the real files under `repoRoot`, writes the report line by line, and returns the exit code. */
export function runCli({ repoRoot, today, write }) {
  const inventory = readInput(join(repoRoot, INVENTORY_PATH))
  const hermes = readInput(join(repoRoot, HERMES_PATH))
  const ledger = readInput(join(repoRoot, LEDGER_PATH))
  const result = checkLedger({
    inventoryText: inventory.text,
    hermesText: hermes.text,
    ledgerText: ledger.text,
    repoRoot,
    today,
    reasons: { inventory: inventory.reason, hermes: hermes.reason, ledger: ledger.reason },
  })
  for (const line of formatReport(result)) write(line)
  return result.violations.length > 0 ? 1 : 0
}

/** The local calendar date as `YYYY-MM-DD`; CI runs in UTC, where it equals the UTC date. */
function localToday() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * True when Node was started on this file. Real paths on both sides, because a symlinked argv[1]
 * would otherwise skip the run and exit 0; an argv[1] that is not a file (an importer's own
 * argument) means this module was imported, not run.
 */
function isDirectRun() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

if (isDirectRun()) {
  process.exitCode = runCli({ repoRoot: REPO_ROOT, today: localToday(), write: console.log })
}
