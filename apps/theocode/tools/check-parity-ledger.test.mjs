import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { ledgerProblems } from './check-parity-ledger.mjs'

const read = (p) => (p === 'a.test.ts' ? "it('test_x')" : null)
const base = { product: 'codex', capability: 'c' }

describe('parity ledger', () => {
  it('test_a_shipped_row_with_existing_evidence_passes', () => {
    const rows = [{ ...base, id: 'r', status: 'shipped', evidence: { file: 'a.test.ts', test: 'test_x' } }]
    expect(ledgerProblems(rows, read)).toEqual([])
  })
  it('test_a_row_with_neither_evidence_nor_reason_fails', () => {
    expect(ledgerProblems([{ ...base, id: 'r', status: 'gap' }], read)[0]).toMatch(/no reason/)
    expect(ledgerProblems([{ ...base, id: 'r', status: 'shipped' }], read)[0]).toMatch(/without evidence/)
  })
  it('test_evidence_naming_a_missing_file_or_test_fails', () => {
    const missingFile = { ...base, id: 'r', status: 'shipped', evidence: { file: 'b.ts', test: 't' } }
    const missingTest = { ...base, id: 's', status: 'shipped', evidence: { file: 'a.test.ts', test: 'nope' } }
    expect(ledgerProblems([missingFile, missingTest], read)).toHaveLength(2)
  })
  it('test_a_row_with_a_reason_passes', () => {
    expect(ledgerProblems([{ ...base, id: 'r', status: 'gap', reason: 'needs a live model' }], read)).toEqual([])
  })
  it('test_a_row_answered_with_unknown_command_fails', () => {
    const rows = [{ ...base, id: 'r', status: 'gap', reason: 'x', answer: 'unknown command' }]
    expect(ledgerProblems(rows, read)[0]).toMatch(/unknown command/)
  })
  it('test_an_answered_codex_command_without_a_row_fails', () => {
    const rows = [{ ...base, id: 'r', status: 'gap', reason: 'x' }]
    expect(ledgerProblems(rows, read, ['recap'])[0]).toMatch(/codex:slash:recap/)
  })
  it('test_an_empty_inventory_fails', () => {
    expect(ledgerProblems([], read)).toHaveLength(1)
  })
  it('test_the_real_inventory_passes', () => {
    const root = new URL('..', import.meta.url).pathname
    const rows = JSON.parse(readFileSync(`${root}docs/parity/inventory.json`, 'utf8')).rows
    const rd = (p) => {
      try {
        return readFileSync(root + p, 'utf8')
      } catch {
        return null
      }
    }
    expect(ledgerProblems(rows, rd)).toEqual([])
  })
})
