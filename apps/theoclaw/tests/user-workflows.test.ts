import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
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

  it('skips a malformed file and still loads the valid one beside it', () => {
    const { load, lines, workspace } = setup(DEF)
    writeFileSync(join(workspace, 'workflows', 'broken.json'), '{ not json')
    expect(load().tools.map((t) => t.name)).toEqual(['release', 'release_resume'])
    expect(lines.some((l) => l.includes('broken.json skipped'))).toBe(true)
  })

  it('does not run the steps after an approval that is refused, and keeps the earlier result', async () => {
    const { load } = setup(DEF)
    const loaded = load()
    const suspended = JSON.parse(String(await loaded.tools[0]!.handler({ text: 'notes' })))
    const message = await load().resume(suspended.runId, false)
    expect(message).toContain('completed')
    expect(message).toContain('out(Draft)')
    expect(message).not.toContain('out(Polish)')
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

  it('resumes a token on the workflow that owns it, among several', async () => {
    const { load, workspace } = setup(DEF)
    writeFileSync(join(workspace, 'workflows', 'audit.json'), JSON.stringify({ ...DEF, name: 'audit' }))
    const loaded = load()
    expect(loaded.names).toEqual(['audit', 'release'])
    const release = loaded.tools.find((t) => t.name === 'release')!
    const suspended = JSON.parse(String(await release.handler({ text: 'notes' })))
    const answer = await load().resume(suspended.runId, true)
    expect(answer).toMatch(new RegExp(`^release ${suspended.runId}: completed`))
  })

  it('lets a resume failure that is not "unknown token" propagate, logged with the token', async () => {
    const { load, lines, workspace } = setup(DEF)
    const loaded = load()
    const suspended = JSON.parse(String(await loaded.tools[0]!.handler({ text: 'notes' })))
    const dir = join(workspace, '.s', 'workflows')
    for (const file of readdirSync(dir, { recursive: true }).map(String)) {
      if (file.includes(suspended.runId)) writeFileSync(join(dir, file), '{ not json')
    }
    await expect(load().resume(suspended.runId, true)).rejects.toThrow(suspended.runId)
    expect(lines.some((l) => l.includes(`${suspended.runId} resume failed`))).toBe(true)
  })
})
