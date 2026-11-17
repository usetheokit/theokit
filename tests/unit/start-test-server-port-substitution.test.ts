import { describe, expect, it } from 'vitest'

import { portOwnership, type RunCommand } from '../../packages/theo/src/testing/start-test-server.js'

const CHILD = 100
const PORT = 4000

/** Fake process table: pid -> ppid. */
function fake(opts: { listeners: number[]; parents: Record<number, number>; fail?: boolean }) {
  const run: RunCommand = (cmd, args) => {
    if (opts.fail) throw new Error(`${cmd} not found`)
    if (cmd === 'lsof') {
      return opts.listeners.map((p) => `p${String(p)}\n`).join('')
    }
    if (cmd === 'netstat') {
      return opts.listeners
        .map((p) => `  TCP    0.0.0.0:${String(PORT)}    0.0.0.0:0    LISTENING    ${String(p)}`)
        .join('\n')
    }
    const pid = Number(/ProcessId=(\d+)/.exec(args.join(' '))?.[1] ?? args.at(-1))
    return String(opts.parents[pid] ?? 1)
  }
  return run
}

describe.each(['darwin', 'win32'] as const)('port ownership on %s', (platform) => {
  it('accepts the child and its descendants', () => {
    const run = fake({ listeners: [102], parents: { 102: 101, 101: CHILD } })
    expect(portOwnership(PORT, CHILD, { platform, run })).toEqual({ owner: 'own' })
  })

  it('detects a substituted foreign listener', () => {
    const run = fake({ listeners: [555], parents: { 555: 1 } })
    expect(portOwnership(PORT, CHILD, { platform, run })).toEqual({ owner: 'foreign' })
  })

  it('treats a port nobody listens on as foreign', () => {
    const run = fake({ listeners: [], parents: {} })
    expect(portOwnership(PORT, CHILD, { platform, run })).toEqual({ owner: 'foreign' })
  })

  it('reports unknown, with the cause, when the probe tool fails', () => {
    const run = fake({ listeners: [], parents: {}, fail: true })
    const res = portOwnership(PORT, CHILD, { platform, run })
    expect(res.owner).toBe('unknown')
    expect(res).toMatchObject({ reason: expect.stringContaining('not found') })
  })
})
