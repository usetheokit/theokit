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
function parseLedger(ledgerText, violations) {
  if (ledgerText === null) {
    violations.push({ id: LEDGER_PATH, rule: 'ledger-parse', detail: 'absent' })
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
function readSource(text, parse, floor, path, violations) {
  if (text === null) {
    violations.push({ id: path, rule: 'source-parse', detail: 'absent' })
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

/** Every violation of the ledger against the two sources, and the counts of its statuses. */
export function checkLedger({ inventoryText, hermesText, ledgerText }) {
  const violations = []
  const ledger = parseLedger(ledgerText, violations)
  const inventory = readSource(inventoryText, parseInventoryIds, INVENTORY_FLOOR, INVENTORY_PATH, violations)
  const hermes = readSource(hermesText, parseHermesIds, HERMES_FLOOR, HERMES_PATH, violations)
  const entries = ledger ?? []

  if (ledger !== null) {
    const ledgerIds = new Set(entries.map((entry) => entry.id))
    for (const id of repeated(entries.map((entry) => entry.id))) {
      violations.push({ id, rule: 'duplicate', detail: 'the ledger answers this row more than once' })
    }
    for (const id of [...(inventory ?? []), ...(hermes ?? [])]) {
      if (!ledgerIds.has(id)) violations.push({ id, rule: 'missing', detail: 'no ledger entry' })
    }
    if (inventory !== null && hermes !== null) {
      const sourceIds = new Set([...inventory, ...hermes])
      for (const id of ledgerIds) {
        if (!sourceIds.has(id)) violations.push({ id, rule: 'extra', detail: 'no source declares this row' })
      }
    }
  }

  const counts = { shipped: 0, out: 0, open: 0 }
  for (const entry of entries) {
    if (Object.hasOwn(counts, entry.status)) counts[entry.status] += 1
  }
  return { counts, violations }
}
