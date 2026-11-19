import { chmodSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const calls: string[] = []
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>()
  return {
    ...real,
    chmod: (...a: Parameters<typeof real.chmod>) => (calls.push('chmod'), real.chmod(...a)),
    appendFile: (...a: Parameters<typeof real.appendFile>) => (
      calls.push('append'),
      real.appendFile(...a)
    ),
  }
})

import { createJsonlLedger } from '../../src/auth/approval-ledger.js'

describe('createJsonlLedger permissions', () => {
  it('tightens an existing world-readable file before writing the receipt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
    const file = join(dir, 'activity.jsonl')
    writeFileSync(file, '')
    chmodSync(file, 0o644)
    calls.length = 0
    await createJsonlLedger(dir).append({
      at: 'x',
      runId: 'r',
      agentId: 'a',
      tool: 't',
      allowed: true,
      decidedBy: 'saved',
      reason: 'ok',
    })
    expect(calls).toEqual(['chmod', 'append'])
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })
})
