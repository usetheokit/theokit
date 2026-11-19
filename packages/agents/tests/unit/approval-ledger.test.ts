import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createJsonlLedger, type ApprovalRecord } from '../../src/auth/approval-ledger.js'

const rec = (tool: string): ApprovalRecord => ({
  at: '2026-01-01T00:00:00.000Z',
  runId: 'r',
  agentId: 'a',
  tool,
  query: { tool, scope: '/x', command: 'ls' },
  allowed: true,
  decidedBy: 'saved',
  reason: 'ok',
})

describe('createJsonlLedger', () => {
  it('appends one line per record, reads them back and uses mode 0600', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'nested')
    const ledger = createJsonlLedger(dir)
    await ledger.append(rec('a'))
    await ledger.append(rec('b'))
    expect((await ledger.read()).map((r) => r.tool)).toEqual(['a', 'b'])
    expect(statSync(join(dir, 'activity.jsonl')).mode & 0o777).toBe(0o600)
  })

  it('reads an absent file as empty and rejects a damaged line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
    const ledger = createJsonlLedger(dir, { fileName: 'x.jsonl' })
    expect(await ledger.read()).toEqual([])
    writeFileSync(join(dir, 'x.jsonl'), '{"a":1}\nnot json\n')
    await expect(ledger.read()).rejects.toThrow(/damaged line 2/)
  })
})
