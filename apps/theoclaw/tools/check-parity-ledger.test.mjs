import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { checkLedger } from './check-parity-ledger.mjs'

const TODAY = '2026-10-06'
const OC_IDS = Array.from({ length: 106 }, (_, i) => `OC-${i + 1}`)
const H_IDS = Array.from({ length: 7 }, (_, i) => `H-${i + 1}`)
const ALL_IDS = [...OC_IDS, ...H_IDS]

function inventoryText(n, extraLines = []) {
  const rows = Array.from({ length: n }, (_, i) => `| OC-${i + 1} | capability ${i + 1} | yes |`)
  return ['# Inventory', '', '| id | capability | ships |', '|---|---|---|', ...rows, ...extraLines, ''].join('\n')
}

function hermesText(n, header = "| # | Hermes' row | What it actually promises |") {
  const rows = Array.from({ length: n }, (_, i) => `| ${i + 1} | row ${i + 1} | promise ${i + 1} |`)
  return ['# Objectives', '', header, '|---|---|---|', ...rows, '', '| 6 runs anywhere | declared |', ''].join('\n')
}

function validOut(id) {
  return {
    id,
    status: 'out',
    reason: 'a written reason of at least eight words lives here',
    declared_by: 'human/paulo',
    declared_on: '2026-10-04',
  }
}

function run(ledger, overrides = {}) {
  return checkLedger({
    inventoryText: inventoryText(106),
    hermesText: hermesText(7),
    ledgerText: typeof ledger === 'string' ? ledger : JSON.stringify(ledger),
    repoRoot: '/nonexistent-repo-root',
    today: TODAY,
    ...overrides,
  })
}

const rulesOf = (result, id) => result.violations.filter((v) => v.id === id).map((v) => v.rule)

describe('check-parity-ledger: the id set', () => {
  it('fails when a source row has no ledger entry', () => {
    const result = run(ALL_IDS.filter((id) => id !== 'OC-5').map(validOut))
    expect(result.violations).toContainEqual(expect.objectContaining({ id: 'OC-5', rule: 'missing' }))
  })

  it('fails when the ledger carries an id no source declares', () => {
    const result = run([...ALL_IDS, 'OC-999'].map(validOut))
    expect(rulesOf(result, 'OC-999')).toEqual(['extra'])
  })

  it('fails when an id appears twice even though the count is 113', () => {
    const ids = [...ALL_IDS.filter((id) => id !== 'H-2'), 'H-1']
    expect(ids).toHaveLength(113)
    const result = run(ids.map(validOut))
    expect(rulesOf(result, 'H-1')).toContain('duplicate')
  })

  it('fails instead of passing when a source parses to fewer rows than its floor', () => {
    const result = run(ALL_IDS.map(validOut), { inventoryText: inventoryText(98) })
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations[0]).toMatchObject({ rule: 'source-parse' })
    expect(result.violations.filter((v) => v.rule !== 'source-parse')).toEqual([])
  })

  it('accepts a ledger whose ids equal the 113 source rows', () => {
    const result = run(ALL_IDS.map(validOut))
    expect(result.violations).toEqual([])
  })

  it('reports every violation in one run', () => {
    const ids = [...ALL_IDS.filter((id) => id !== 'OC-5'), 'OC-999', 'H-1']
    const result = run(ids.map(validOut))
    expect(result.violations).toHaveLength(3)
    expect(result.violations.map((v) => `${v.id} ${v.rule}`).sort()).toEqual([
      'H-1 duplicate',
      'OC-5 missing',
      'OC-999 extra',
    ])
  })

  it('fails when a source lists the same row twice', () => {
    const text = inventoryText(106, ['| OC-5 | capability 5 again | yes |'])
    const result = run(ALL_IDS.map(validOut), { inventoryText: text })
    expect(result.violations).toContainEqual(expect.objectContaining({ id: 'OC-5', rule: 'source-parse' }))
  })

  it('reports an unreadable ledger as a violation instead of crashing', () => {
    for (const ledgerText of ['[{"id":"OC-1",}]', '{}']) {
      const result = run(ledgerText)
      expect(result.violations.map((v) => v.rule)).toEqual(['ledger-parse'])
    }
    const badElement = run([...ALL_IDS.map(validOut), { status: 'open' }])
    expect(badElement.violations.map((v) => v.rule)).toEqual(['ledger-parse'])
    expect(badElement.violations[0].detail).toMatch(/113/)
  })

  it('fails when the Hermes table header is renamed', () => {
    const result = run(ALL_IDS.map(validOut), { hermesText: hermesText(7, '| # | Hermes row | promise |') })
    const sourceParse = result.violations.filter((v) => v.rule === 'source-parse')
    expect(sourceParse).toHaveLength(1)
    expect(sourceParse[0].detail).toMatch(/0 of 7/)
  })

  it('imports only Node built-ins and opens no network or process', () => {
    const collect = (text) => [
      ...[...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]),
      ...[...text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ]
    // The collector must see an import when one is there, or an empty result proves nothing.
    expect(collect("import { a } from 'node:fs'\nconst b = await import('vitest')\nimport 'x'\nrequire('y')")).toEqual([
      'node:fs',
      'vitest',
      'x',
      'y',
    ])
    const source = readFileSync(fileURLToPath(new URL('./check-parity-ledger.mjs', import.meta.url)), 'utf8')
    expect(collect(source).filter((s) => !/^node:(fs|path|url)$/.test(s))).toEqual([])
    expect(source).not.toMatch(/child_process|node:https?|\bfetch\(/)
  })
})
