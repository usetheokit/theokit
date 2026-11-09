import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * AC-010 (B-400 FR-011): only a row whose whole capability shipped is `shipped`. OC-97 (usage and
 * cost) is, with its live check named beside it; OC-98 and OC-99 keep their unbuilt halves (log
 * export, Prometheus and anonymous telemetry in B-712; offsite snapshots in B-713) and stay open.
 */
interface Row {
  readonly id: string
  readonly status: string
  readonly check?: { readonly path: string; readonly test: string }
  readonly verified_on?: string
}

const APP = join(__dirname, '..')
const rows = JSON.parse(readFileSync(join(APP, 'parity', 'ledger.json'), 'utf8')) as Row[]
const row = (id: string): Row | undefined => rows.find((entry) => entry.id === id)

describe('the usage, telemetry and backup rows of the parity ledger', () => {
  it('OC-97 is shipped with the usage live check; OC-98 and OC-99 are open', () => {
    const usage = row('OC-97')
    expect(usage?.status).toBe('shipped')
    expect(usage?.check?.path).toBe('apps/theoclaw/tests/live/usage.live.test.ts')
    const live = readFileSync(join(APP, 'tests', 'live', 'usage.live.test.ts'), 'utf8')
    expect(live).toContain(`it(${JSON.stringify(usage?.check?.test)}`)
    expect(usage?.verified_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(row('OC-98')?.status).toBe('open')
    expect(row('OC-99')?.status).toBe('open')
  })
})
