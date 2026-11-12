import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createHookApprovalGate, hookFingerprint } from '../src/agent/hook-approval.js'
import { runCli } from '../src/cli.js'
import { harness, scratchDir } from './support/cli-harness.js'

function workspaceWith(settings: unknown): string {
  const workspace = scratchDir()
  mkdirSync(join(workspace, '.theokit'))
  writeFileSync(join(workspace, '.theokit', 'settings.json'), JSON.stringify(settings))
  return workspace
}

async function run(args: string[], workspace: string, approved = '') {
  const h = harness()
  const code = await runCli(args, {
    ...h.io,
    env: { ...h.io.env, THEOCLAW_WORKSPACE: workspace, THEOCLAW_APPROVED_HOOKS: approved },
  })
  return { code, out: h.stdout(), err: h.stderr() }
}

const hook = (command: string, timeout?: number) => ({
  matcher: '*',
  hooks: [{ type: 'command', command, ...(timeout === undefined ? {} : { timeout }) }],
})

describe('theoclaw hooks list', () => {
  it('marks the approved hook and the unapproved one, with fingerprints the gate accepts', async () => {
    const workspace = workspaceWith({ hooks: { PreToolUse: [hook('echo a'), hook('echo b')] } })
    const a = hookFingerprint({ sourceEvent: 'PreToolUse', command: 'echo a', timeoutMs: 30_000 })
    const b = hookFingerprint({ sourceEvent: 'PreToolUse', command: 'echo b', timeoutMs: 30_000 })
    const { code, out } = await run(['hooks', 'list'], workspace, a)
    expect(code).toBe(0)
    expect(out.split('\n').filter(Boolean)).toEqual([`PreToolUse\t${a}\tapproved`, `PreToolUse\t${b}\tnot approved`])
    const gate = createHookApprovalGate(new Set([a]))
    expect(gate.approve?.({ sourceEvent: 'PreToolUse', event: 'preToolUse', command: 'echo a', timeoutMs: 30_000 } as never)).toBe(true)
  })

  it('uses the hook timeout in the fingerprint', async () => {
    const workspace = workspaceWith({ hooks: { Stop: [hook('touch x', 5)] } })
    const { out } = await run(['hooks', 'list'], workspace)
    expect(out).toContain(hookFingerprint({ sourceEvent: 'Stop', command: 'touch x', timeoutMs: 5000 }))
  })

  it('exits 1 with no settings file or no hooks', async () => {
    expect((await run(['hooks', 'list'], scratchDir())).code).toBe(1)
    expect((await run(['hooks', 'list'], workspaceWith({}))).code).toBe(1)
  })

  it('refuses other arguments', async () => {
    expect((await run(['hooks'], scratchDir())).code).toBe(2)
  })
})
