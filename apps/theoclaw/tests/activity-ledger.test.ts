import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { auditCommand, createActivityLedger } from '../src/audit/activity-ledger.js'
import { createExecApprovalStore, execApprovalPlugin } from '../src/tools/exec-approval.js'
import { handlerOf } from './support/plugin-host.js'

const sink = (): { stream: Writable; text: () => string } => {
  let out = ''
  return { stream: new Writable({ write: (c, _e, cb) => ((out += String(c)), cb()) }), text: () => out }
}

describe('activity ledger', () => {
  it('shows the command, the approver and the time for a run', async () => {
    const state = mkdtempSync(join(tmpdir(), 'ledger-'))
    const handler = handlerOf(execApprovalPlugin({ store: createExecApprovalStore(state), ledger: createActivityLedger(state), ask: async () => 'once' })) as (c: unknown) => Promise<unknown>
    await handler({ name: 'shell_exec', args: { command: 'make build' }, agentId: 'a1', runId: 'run-42' })
    await handler({ name: 'shell_exec', args: { command: 'ls' }, agentId: 'a1', runId: 'run-other' })
    const out = sink()
    const err = sink()
    const code = auditCommand(['--run', 'run-42'], { env: { THEOCLAW_STATE_DIR: state }, homeDir: state, stdout: out.stream, stderr: err.stream })
    expect(code).toBe(0)
    expect(out.text()).toMatch(/^\d{4}-\d\d-\d\dT.* run run-42 shell_exec approved by person .*: make build\n$/)
    expect(auditCommand(['--run', 'nope'], { env: { THEOCLAW_STATE_DIR: state }, homeDir: state, stdout: out.stream, stderr: err.stream })).toBe(1)
  })
})
