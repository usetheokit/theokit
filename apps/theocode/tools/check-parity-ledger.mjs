#!/usr/bin/env node
/**
 * B-417 — the Codex and Claude Code inventory (`docs/parity/inventory.json`) and its gate.
 *
 * A row is one capability of one product. It is acceptable in exactly two shapes:
 *   - `status: "shipped"` with `evidence: { file, test }` — a test file that exists and names that test;
 *   - any other status (`pointer`, `gap`, `not-planned`) with a non-empty `reason`.
 * A row answered with `unknown command` fails outright, and so does a Codex slash command that
 * `codex-names.ts` answers but the inventory has no row for.
 *
 * "Passing" is a claim about a test run. This file checks the evidence EXISTS; `--run` also executes
 * the evidence files with vitest and fails if they do not pass. Rows needing a live model carry a
 * reason instead of evidence, never a shipped status.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseLocalSurface } from './check-codex-parity.mjs'

const INVENTORY_PATH = 'docs/parity/inventory.json'
const PRODUCTS = ['codex', 'claude-code']
const STATUSES = ['shipped', 'pointer', 'gap', 'not-planned']
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0

/** Problems with the rows, one string each. `read` returns a file's text or null. */
export function ledgerProblems(rows, read, answeredCodexNames = []) {
  const out = []
  if (!Array.isArray(rows) || rows.length === 0) return ['inventory has no rows']
  const seen = new Set()
  for (const row of rows) {
    const id = row?.id
    if (!nonEmpty(id)) {
      out.push('a row has no id')
      continue
    }
    if (seen.has(id)) out.push(`${id}: duplicate id`)
    seen.add(id)
    if (!PRODUCTS.includes(row.product)) out.push(`${id}: product must be one of ${PRODUCTS.join(', ')}`)
    if (!nonEmpty(row.capability)) out.push(`${id}: no capability`)
    if (!STATUSES.includes(row.status)) {
      out.push(`${id}: status must be one of ${STATUSES.join(', ')}`)
      continue
    }
    if (/unknown command/i.test(row.answer ?? '') || /^unknown[- ]command$/i.test(row.status)) {
      out.push(`${id}: answered with 'unknown command'`)
    }
    if (row.status === 'shipped') {
      const ev = row.evidence
      if (!ev || !nonEmpty(ev.file) || !nonEmpty(ev.test)) {
        out.push(`${id}: shipped without evidence {file, test}`)
        continue
      }
      const text = read(ev.file)
      if (text === null) out.push(`${id}: evidence file ${ev.file} does not exist`)
      else if (!text.includes(ev.test)) out.push(`${id}: ${ev.file} does not contain test '${ev.test}'`)
    } else if (!nonEmpty(row.reason)) {
      out.push(`${id}: ${row.status} with no reason`)
    }
  }
  for (const name of answeredCodexNames) {
    if (!seen.has(`codex:slash:${name}`)) out.push(`codex:slash:${name}: answered by codex-names.ts but missing from the inventory`)
  }
  return out
}

function main(argv) {
  const root = process.env['PARITY_LEDGER_ROOT'] ?? join(dirname(fileURLToPath(import.meta.url)), '..')
  const say = (l) => process.stdout.write(`${l}\n`)
  const file = join(root, INVENTORY_PATH)
  if (!existsSync(file)) {
    say(`[parity-ledger] ${INVENTORY_PATH} not found`)
    return 1
  }
  let rows
  try {
    rows = JSON.parse(readFileSync(file, 'utf8')).rows
  } catch (e) {
    say(`[parity-ledger] ${INVENTORY_PATH} is not valid JSON: ${e.message}`)
    return 1
  }
  const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null)
  const names = read('packages/tui/src/commands/codex-names.ts')
  const registry = read('packages/tui/src/commands/registry.ts')
  const answered = names && registry ? [...parseLocalSurface(registry, names).pointers] : []
  const problems = ledgerProblems(rows, read, answered)
  if (problems.length === 0 && argv.includes('--run')) {
    const files = [...new Set(rows.filter((r) => r.status === 'shipped').map((r) => r.evidence.file))]
    const r = spawnSync('npx', ['vitest', 'run', ...files], { cwd: root, stdio: 'inherit' })
    if (r.status !== 0) problems.push('evidence tests did not pass')
  }
  for (const p of problems) say(`[parity-ledger] ${p}`)
  if (problems.length === 0 && !argv.includes('--quiet')) say(`[parity-ledger] ${rows.length} rows, each with a check or a reason`)
  return problems.length === 0 ? 0 : 1
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)))
