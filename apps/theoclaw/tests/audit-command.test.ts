import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { createJsonlLedger } from '@theokit/agents/auth'

import { execApprovalPlugin, createExecApprovalStore } from '../src/tools/exec-approval.js'
import { handlerOf } from './support/plugin-host.js'
import { harness, scratchDir } from './support/cli-harness.js'

describe('theoclaw audit', () => {
  it('shows the command, who approved it and when after an approved shell_exec', async () => {
    const state = scratchDir()
    const plugin = execApprovalPlugin({
      store: createExecApprovalStore(state),
      ledger: createJsonlLedger(state),
      ask: async () => ({ answer: 'once', by: 'telegram:42' }),
    })
    const hook = handlerOf(plugin) as (context: unknown) => Promise<unknown>
    expect(await hook({ name: 'shell_exec', args: { command: 'make test' }, agentId: 'a1', runId: 'run-7' })).toBeUndefined()
    await hook({ name: 'read_file', args: { path: 'x' }, runId: 'run-8' })

    const h = harness()
    const code = await runCli(['audit', '--run', 'run-7'], { ...h.io, env: { ...h.io.env, THEOCLAW_STATE_DIR: state } })
    expect(code).toBe(0)
    expect(h.stdout()).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z run=run-7 shell_exec approved by person:telegram:42 .*"make test"/)

    const other = harness()
    expect(await runCli(['audit', '--run', 'run-9'], { ...other.io, env: { ...other.io.env, THEOCLAW_STATE_DIR: state } })).toBe(1)
  })

  it('still shows a receipt written before the framework ledger', async () => {
    const state = scratchDir()
    appendFileSync(join(state, 'activity.jsonl'), `${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', runId: 'old-1', tool: 'shell_exec', command: 'ls -la', allowed: true, decidedBy: 'person', reason: 'the person approved it' })}\n`)
    const h = harness()
    expect(await runCli(['audit'], { ...h.io, env: { ...h.io.env, THEOCLAW_STATE_DIR: state } })).toBe(0)
    expect(h.stdout()).toContain('run=old-1 shell_exec approved by person')
    expect(h.stdout()).toContain('"ls -la"')
  })
})
