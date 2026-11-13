import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createWorkflowApproveHook } from '../src/channels/workflow-approve-hook.js'
import { loadUserWorkflows } from '../src/workflows/user-workflows.js'

function setup(def: unknown) {
  const workspace = mkdtempSync(join(tmpdir(), 'uwf-'))
  mkdirSync(join(workspace, 'workflows'))
  writeFileSync(join(workspace, 'workflows', 'release.json'), JSON.stringify(def))
  const lines: string[] = []
  const generate = (async (prompt: string) => ({ result: `out(${prompt.split('\n')[0]})` })) as never
  const load = () => loadUserWorkflows({ workspace, stateDir: join(workspace, '.s'), generate, write: (l) => lines.push(l) })
  return { load, lines, workspace }
}

const DEF = {
  name: 'release',
  description: 'Prepare a release note',
  steps: [{ id: 'draft', prompt: 'Draft' }, { id: 'ok', approve: true }, { id: 'polish', prompt: 'Polish' }],
}

describe('workspace workflows', () => {
  it('registers a file as a tool, suspends, and resumes with /approve <token>, even in a new load', async () => {
    const { load } = setup(DEF)
    const first = load()
    expect(first.tools.map((t) => t.name)).toEqual(['release', 'release_resume'])
    const suspended = JSON.parse(String(await first.tools[0]!.handler({ text: 'notes' })))
    expect(suspended.status).toBe('suspended')
    const hook = createWorkflowApproveHook({ isOwner: () => true, resume: load().resume })
    const event = { text: `/approve ${suspended.runId}`, platform: 'telegram', sender: { id: '1' } } as never
    const decision = (await hook.pre_inbound!({ event } as never)) as { block: boolean; message: string }
    expect(decision.block).toBe(true)
    expect(decision.message).toContain('completed')
    expect(decision.message).toContain('out(Polish)')
    expect(await load().resume(suspended.runId, true)).toBeUndefined()
  })

  it('skips a file that is invalid or takes a reserved name', () => {
    const { load, lines } = setup({ ...DEF, name: 'triage' })
    expect(load().tools).toEqual([])
    expect(lines[0]).toContain('skipped')
  })

  it('surfaces a resume failure with the workflow name and token, not as an unknown token', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'uwf-'))
    mkdirSync(join(workspace, 'workflows'))
    writeFileSync(join(workspace, 'workflows', 'release.json'), JSON.stringify(DEF))
    const lines: string[] = []
    let calls = 0
    const generate = (async () => {
      calls += 1
      if (calls > 1) throw new Error('model exploded')
      return { result: 'draft' }
    }) as never
    const stateDir = join(workspace, '.s')
    const load = () => loadUserWorkflows({ workspace, stateDir, generate, write: (l) => lines.push(l) })
    const first = load()
    const suspended = JSON.parse(String(await first.tools[0]!.handler({ text: 'notes' })))
    const hook = createWorkflowApproveHook({ isOwner: () => true, resume: load().resume })
    const event = { text: `/approve ${suspended.runId}`, platform: 'telegram', sender: { id: '1' } } as never
    const decision = (await hook.pre_inbound!({ event } as never)) as { block: boolean; message: string }
    expect(decision.message).toContain('model exploded')
    expect(decision.message).toContain('release')
    expect(decision.message).toContain(suspended.runId)
    expect(decision.message).not.toContain('No suspended workflow run')
  })

  it('still answers an unknown token as unknown', async () => {
    const { load } = setup(DEF)
    const loaded = load()
    expect(await loaded.resume('wfr-nope', true)).toBeUndefined()
    const hook = createWorkflowApproveHook({ isOwner: () => true, resume: loaded.resume })
    const event = { text: '/approve wfr-nope', platform: 'telegram', sender: { id: '1' } } as never
    const decision = (await hook.pre_inbound!({ event } as never)) as { block: boolean; message: string }
    expect(decision.message).toBe('No suspended workflow run has that token.')
  })
})
