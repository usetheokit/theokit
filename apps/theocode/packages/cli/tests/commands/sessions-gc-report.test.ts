/**
 * `sessions gc` for the current project runs through the shared `sessionsGcCommand`: the JSON report
 * is one stdout line, the human report goes to stderr, and a failed removal sets the exit code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@theokit/agents', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  Agent: {
    list: () => Promise.resolve({ items: [] }),
    delete: () => Promise.resolve(),
  },
}))

import { sessionsCommand } from '../../src/commands/sessions.js'

describe('sessions gc report', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('writes the JSON report to stdout only', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await sessionsCommand({ action: 'gc', apply: false, json: true } as never)
    const lines = out.mock.calls.map((c) => String(c[0])).join('').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'sessions.gc', dryRun: true })
    expect(err.mock.calls.join('')).toBe('')
    expect(process.exitCode).toBe(0)
  })

  it('writes the human report to stderr', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await sessionsCommand({ action: 'gc', apply: false, json: false } as never)
    expect(out.mock.calls.join('')).toBe('')
    expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('[sessions gc] DRY-RUN')
    expect(process.exitCode).toBe(0)
  })
})
