import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import {
  checkLedger,
  HERMES_PATH,
  INVENTORY_PATH,
  LEDGER_PATH,
  parseHermesIds,
  parseInventoryIds,
} from './check-parity-ledger.mjs'

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
    expect(collect(source).length).toBeGreaterThan(0)
    expect(collect(source).filter((s) => !/^node:(fs|path|url)$/.test(s))).toEqual([])
    expect(source).not.toMatch(/child_process|node:https?|\bfetch\(/)
  })
})

const tempRoots = []
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'parity-repo-'))
  tempRoots.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

function shipped(id, path, test = `proves ${id}`, verified_on = TODAY) {
  return { id, status: 'shipped', check: { path, test }, verified_on }
}

function judge(entries, repoRoot) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const ledger = [...ALL_IDS.filter((id) => !byId.has(id)).map(validOut), ...entries]
  return run(ledger, repoRoot === undefined ? {} : { repoRoot })
}

const dayAfter = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

describe('check-parity-ledger: each entry answer', () => {
  it('fails on an entry with neither a check nor a reason', () => {
    const result = judge([{ id: 'OC-1', status: 'open' }])
    const found = rulesOf(result, 'OC-1')
    expect(found).toEqual(['open'])
  })

  it('fails on a shipped entry whose check path leaves the repository', () => {
    const root = tempRepo()
    const result = judge([shipped('OC-1', '../outside.test.ts')], root)
    expect(rulesOf(result, 'OC-1')).toContain('check-outside-repo')
  })

  it('fails on a shipped entry whose check path does not exist', () => {
    const root = tempRepo()
    const result = judge([shipped('OC-1', 'tests/e2e/absent.test.ts')], root)
    expect(rulesOf(result, 'OC-1')).toContain('check-missing')
  })

  it('fails on a shipped entry whose check file does not contain the named test', () => {
    const root = tempRepo({ 'tests/e2e/proof.test.ts': "it('proves something else', () => {})\n" })
    const result = judge([shipped('OC-1', 'tests/e2e/proof.test.ts')], root)
    expect(rulesOf(result, 'OC-1')).toContain('check-test-absent')
  })

  it('fails on an out entry not declared by a human', () => {
    const result = judge([{ ...validOut('OC-11'), declared_by: 'judge/alignment-judge' }])
    expect(rulesOf(result, 'OC-11')).toContain('declarer-not-human')
  })

  it('fails on Hermes row 7 while it carries no decision', () => {
    const open = judge([{ id: 'H-7', status: 'open' }])
    expect(open.violations.map((v) => v.id)).toContain('H-7')
    expect(rulesOf(open, 'H-7')).toEqual(['open'])
    const byAgent = judge([{ ...validOut('H-7'), declared_by: 'judge/alignment-judge' }])
    expect(byAgent.violations.map((v) => v.id)).toContain('H-7')
    expect(rulesOf(byAgent, 'H-7')).toEqual(['declarer-not-human'])
  })

  it('fails on a shipped entry whose check path is a symlink leaving the repository', () => {
    const elsewhere = tempRepo({ 'proof.test.ts': "it('proves OC-1', () => {})\n" })
    const root = tempRepo()
    mkdirSync(join(root, 'tests'), { recursive: true })
    symlinkSync(join(elsewhere, 'proof.test.ts'), join(root, 'tests/link.test.ts'))
    const result = judge([shipped('OC-1', 'tests/link.test.ts')], root)
    expect(rulesOf(result, 'OC-1')).toContain('check-outside-repo')
  })

  it('fails on a shipped entry whose check path is a directory', () => {
    const root = tempRepo({ 'tests/keep.txt': 'x' })
    const result = judge([shipped('OC-1', 'tests')], root)
    expect(rulesOf(result, 'OC-1')).toContain('check-missing')
  })

  it('fails on a shipped entry with an empty test name', () => {
    const root = tempRepo({ 'tests/e2e/proof.test.ts': "it('proves OC-1', () => {})\n" })
    const result = judge([shipped('OC-1', 'tests/e2e/proof.test.ts', '  ')], root)
    expect(rulesOf(result, 'OC-1')).toContain('check-test-absent')
  })

  it('accepts verified_on today and refuses a later or impossible date', () => {
    const root = tempRepo({ 'tests/e2e/proof.test.ts': "it('proves OC-1', () => {})\n" })
    const path = 'tests/e2e/proof.test.ts'
    expect(rulesOf(judge([shipped('OC-1', path, 'proves OC-1', TODAY)], root), 'OC-1')).toEqual([])
    for (const date of [dayAfter(TODAY), '2026-02-30', '2026-13-01', '2026-01-32']) {
      expect(rulesOf(judge([shipped('OC-1', path, 'proves OC-1', date)], root), 'OC-1')).toContain('verified-on')
    }
    for (const date of ['2026-02-30', '2026-13-01', '2026-01-32']) {
      expect(rulesOf(judge([{ ...validOut('OC-11'), declared_on: date }]), 'OC-11')).toContain('declared-on')
    }
    expect(rulesOf(judge([{ ...validOut('OC-11'), declared_on: dayAfter(TODAY) }]), 'OC-11')).toEqual([])
  })

  it('fails on an entry whose status is not open, shipped or out', () => {
    const result = judge([{ id: 'OC-1', status: 'banana' }])
    expect(rulesOf(result, 'OC-1')).toEqual(['unknown-status'])
  })

  it('judges an extra entry as well as reporting it extra', () => {
    const result = run([...ALL_IDS.map(validOut), { id: 'OC-999', status: 'banana' }])
    expect(rulesOf(result, 'OC-999').sort()).toEqual(['extra', 'unknown-status'])
  })

  it('reports an unreadable cited test file as a violation and keeps going', () => {
    const root = tempRepo()
    const result = judge([shipped('OC-1', 'tests/a\u0000b.test.ts'), { id: 'OC-2', status: 'open' }], root)
    expect(rulesOf(result, 'OC-1')).toEqual(['check-unreadable'])
    expect(rulesOf(result, 'OC-2')).toEqual(['open'])
  })

  it('accepts a check path whose first segment only starts with two dots', () => {
    const root = tempRepo({ '..proof/valid.test.ts': "it('proves OC-1', () => {})\nit('proves OC-2', () => {})\n" })
    const result = judge(
      [shipped('OC-1', '..proof/valid.test.ts'), shipped('OC-2', '../proof/valid.test.ts')],
      root,
    )
    expect(rulesOf(result, 'OC-1')).toEqual([])
    expect(rulesOf(result, 'OC-2')).toContain('check-outside-repo')
  })

  it('accepts an 8-word reason and refuses a 7-word one', () => {
    const eight = { ...validOut('OC-11'), reason: 'one two three four five six seven eight' }
    expect(rulesOf(judge([eight]), 'OC-11')).toEqual([])
    const seven = { ...validOut('OC-11'), reason: 'one two three four five six seven' }
    expect(rulesOf(judge([seven]), 'OC-11')).toContain('reason-short')
  })
})

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SEED_OUT = ['OC-11', 'OC-15', 'OC-16', 'OC-29', 'OC-38', 'OC-39', 'OC-42', 'OC-43', 'H-6']
const readReal = (path) => readFileSync(join(REPO_ROOT, path), 'utf8')

function readRealInputs() {
  return {
    inventoryText: readReal(INVENTORY_PATH),
    hermesText: readReal(HERMES_PATH),
    ledgerText: readReal(LEDGER_PATH),
    repoRoot: REPO_ROOT,
    today: TODAY,
  }
}

describe('check-parity-ledger: the real ledger', () => {
  it('the real ledger holds exactly the 113 source ids', () => {
    const realLedger = JSON.parse(readReal(LEDGER_PATH))
    const sourceIds = [...parseInventoryIds(readReal(INVENTORY_PATH)), ...parseHermesIds(readReal(HERMES_PATH))]
    expect(sourceIds).toHaveLength(113)
    expect(realLedger).toHaveLength(113)
    expect(realLedger.map((e) => e.id).sort()).toEqual([...sourceIds].sort())
  })

  it('the real ledger seeds only the out rows a person declared', () => {
    const realLedger = JSON.parse(readReal(LEDGER_PATH))
    const byId = Object.fromEntries(realLedger.map((e) => [e.id, e]))
    const outEntries = realLedger.filter((e) => e.status === 'out')
    expect(outEntries.filter((e) => !/^human\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(e.declared_by))).toEqual([])
    expect(outEntries.filter((e) => typeof e.declared_at !== 'string' || e.declared_at.trim() === '')).toEqual([])
    expect(SEED_OUT.filter((id) => !['out', 'shipped'].includes(byId[id]?.status))).toEqual([])
  })

  it('checks the real ledger in under 10 seconds', () => {
    const inputs = readRealInputs()
    const t = performance.now()
    checkLedger(inputs)
    expect(performance.now() - t).toBeLessThan(10000)
  })
})
