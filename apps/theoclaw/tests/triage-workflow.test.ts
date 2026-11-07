import type { CustomTool } from '@theokit/sdk'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createObjectGenerator } from '../src/workflows/object-generator.js'
import type { GenerateObject } from '../src/workflows/triage-workflow.js'
import { createWorkflowTools } from '../src/workflows/workflow-tools.js'

const GOOD = { category: 'bug', summary: 'the build is broken' }

function harness(generate: GenerateObject) {
  const lines: string[] = []
  const tools = createWorkflowTools({ generateObject: generate, write: (line) => lines.push(line) })
  const byName = (name: string): CustomTool => tools.find((tool) => tool.name === name) as CustomTool
  return { lines, tools, triage: byName('triage'), resume: byName('triage_resume') }
}
const good: GenerateObject = async (_prompt, schema) => schema.parse(GOOD)

describe('the triage tools', () => {
  it('registers none without a JSON-only model call', () => {
    expect(createWorkflowTools({ write: () => {} })).toEqual([])
  })

  it('suspends with a run id, then resumes through the tool with that id', async () => {
    const h = harness(good)
    expect(h.tools.map((tool) => tool.name)).toEqual(['triage', 'triage_resume'])
    const report = JSON.parse(String(await h.triage.handler({ text: 'it fails' })))
    expect(report).toMatchObject({ status: 'suspended', stepId: 'approve' })
    expect(report.runId).toMatch(/^wfr-/)
    const out = JSON.parse(String(await h.resume.handler({ runId: report.runId, payload: { approved: true } })))
    expect(out).toEqual({ ...GOOD, approved: true })
    expect(h.lines.join('\n')).not.toContain('it fails')
  })

  it('refuses a run id that was already resumed or never existed', async () => {
    const h = harness(good)
    const report = JSON.parse(String(await h.triage.handler({ text: 'it fails' })))
    await h.resume.handler({ runId: report.runId, payload: { approved: false } })
    await expect(Promise.resolve(h.resume.handler({ runId: report.runId, payload: { approved: true } }))).rejects.toThrow()
    await expect(Promise.resolve(h.resume.handler({ runId: 'wfr-nope', payload: { approved: true } }))).rejects.toThrow()
  })

  it('rejects a payload that is not { approved }', async () => {
    const h = harness(good)
    const report = JSON.parse(String(await h.triage.handler({ text: 'it fails' })))
    await expect(Promise.resolve(h.resume.handler({ runId: report.runId, payload: { approved: 'yes' } }))).rejects.toThrow()
  })

  it('fails the run when the JSON-only step returns an object the schema refuses', async () => {
    const h = harness(async () => ({ category: 'nonsense' }))
    await expect(Promise.resolve(h.triage.handler({ text: 'it fails' }))).rejects.toThrow()
  })
})

describe('the object generator', () => {
  it('calls generateObject with shell withheld and memory off', async () => {
    const { Agent } = await import('@theokit/sdk')
    const spy = vi.spyOn(Agent, 'generateObject').mockResolvedValue({ object: GOOD } as never)
    const out = await createObjectGenerator({ THEOCLAW_MODEL: 'openrouter/m', OPENROUTER_API_KEY: 'k' }, '/w')(
      'p',
      z.object({ category: z.string() }),
    )
    expect(out).toEqual(GOOD)
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ withheldBuiltinTools: ['shell'], memory: { enabled: false }, local: { cwd: '/w' }, apiKey: 'k' })
    spy.mockRestore()
  })
})
