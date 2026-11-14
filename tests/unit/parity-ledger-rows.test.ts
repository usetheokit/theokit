/** The shared parity-ledger rules: a test that is commented out, skipped or only quoted is not evidence. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  checkLedgerRows,
  declaresActiveTest,
  ParityEvidencePathError,
  resolveEvidenceFile,
} from '../../scripts/lib/parity-ledger.mjs'

const root = mkdtempSync(join(tmpdir(), 'parity-ledger-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
mkdirSync(join(root, 'tests'))
writeFileSync(join(root, 'tests/a.test.ts'), "it('does the thing', () => {})\n")

const options = {
  statuses: ['shipped', 'gap'],
  shippedStatus: 'shipped',
  repoRoot: root,
  minReasonWords: 4,
}

describe('parity ledger rows', () => {
  it('a test title inside a block comment is not an active test', () => {
    expect(declaresActiveTest("/*\n  it('does the thing', () => {})\n*/", 'does the thing')).toBe(
      false,
    )
    expect(declaresActiveTest("it('does the thing', () => {})", 'does the thing')).toBe(true)
  })

  it('it.skip and it.todo are not active tests', () => {
    expect(declaresActiveTest("it.skip('x', () => {})", 'x')).toBe(false)
    expect(declaresActiveTest("it.todo('x')", 'x')).toBe(false)
  })

  it('a title that appears only inside a string literal is not an active test', () => {
    expect(declaresActiveTest('const s = "it(\'x\', () => {})"', 'x')).toBe(false)
  })

  it('an evidence path with ../ that leaves the root is refused', () => {
    expect(() => resolveEvidenceFile(root, '../etc/passwd')).toThrow(ParityEvidencePathError)
    expect(() => resolveEvidenceFile(root, '../etc/passwd')).toThrow(/\.\.\/etc\/passwd/)
    expect(resolveEvidenceFile(root, 'tests/a.test.ts')).toBe(join(root, 'tests/a.test.ts'))
  })

  it('a shipped row whose evidence file is missing is a violation', () => {
    const { violations } = checkLedgerRows(
      [{ id: 'R1', status: 'shipped', evidence: { file: 'tests/missing.test.ts', test: 'x' } }],
      options,
    )
    expect(violations).toHaveLength(1)
    const ok = checkLedgerRows(
      [
        {
          id: 'R1',
          status: 'shipped',
          evidence: { file: 'tests/a.test.ts', test: 'does the thing' },
        },
      ],
      options,
    )
    expect(ok.violations).toEqual([])
  })

  it('a non-shipped row with a reason shorter than minReasonWords is a violation', () => {
    const { violations } = checkLedgerRows(
      [{ id: 'R2', status: 'gap', reason: 'too short' }],
      options,
    )
    expect(violations).toHaveLength(1)
    expect(
      checkLedgerRows([{ id: 'R2', status: 'gap', reason: 'a reason of four words' }], options)
        .violations,
    ).toEqual([])
  })

  it('counts are reported per status', () => {
    const { counts, violations } = checkLedgerRows(
      [
        { id: 'A', status: 'gap', reason: 'a reason of four words' },
        { id: 'B', status: 'gap', reason: 'a reason of four words' },
        { id: 'B', status: 'weird' },
      ],
      options,
    )
    expect(counts).toEqual({ shipped: 0, gap: 2 })
    expect(violations).toHaveLength(2)
  })
})
