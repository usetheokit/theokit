/**
 * #1912 — `AgentBuilder.withholdBuiltinTools` reaches `Agent.create` on every run path, not only
 * `toAgentFactory({ withholdBuiltinShell })`.
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const h = vi.hoisted(() => ({ created: [] as Record<string, unknown>[] }))

vi.mock('@theokit/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Agent: {
    getOrCreate: (_id: string, opts: Record<string, unknown>) => {
      h.created.push(opts)
      return Promise.resolve({
        agentId: 'a1',
        send: () => Promise.resolve({ wait: () => Promise.resolve({ result: 'ok' }) }),
        dispose: () => Promise.resolve(),
      })
    },
  },
  Tool: { create: (spec: unknown) => spec },
}))

const { AgentBuilder } = await import('../../src/bridge/agent-builder.js')
const { ConfigurationError } = await import('../../src/errors.js')
const { assembleM8CreateOptions } = await import('../../src/bridge/sdk-adapter-create-options.js')
const { toAgentFactory } = await import('../../src/bridge/sdk-adapter.js')
const { streamAgentTurnInProcess } = await import('../../src/in-process-turn.js')

const POSTURE = {
  kind: 'auto-approve' as const,
  confinedBy: { mode: 'workspace-write' as const, enforced: true, detail: 'test double' },
  reason: 'test surface',
}

function base() {
  return AgentBuilder.create()
    .input(z.object({ m: z.string() }))
    .model('test/model')
}

describe('withholdBuiltinTools', () => {
  it('withheld builtins reach Agent.create on the in-process path', async () => {
    h.created.length = 0
    const def = base().withholdBuiltinTools(['shell']).build()
    // Default deps: the real `streamAgentUIMessages`, down to the fake SDK runtime.
    for await (const _ of streamAgentTurnInProcess({ default: def } as never, 'key', {
      message: 'hi',
    })) {
      // drain: running the generator is what builds the agent
    }
    expect(h.created).toHaveLength(1)
    expect(h.created[0]?.withheldBuiltinTools).toEqual(['shell'])
  })

  it('reaches Agent.create through toAgentFactory', async () => {
    h.created.length = 0
    const def = base().withholdBuiltinTools(['memory_get']).build()
    await toAgentFactory(def as never, { apiKey: 'k', approvals: POSTURE })('s1')
    expect(h.created[0]?.withheldBuiltinTools).toEqual(['memory_get'])
  })

  it('keeps withholdBuiltinShell working alone and unions with the builder call', async () => {
    h.created.length = 0
    await toAgentFactory(base().build() as never, {
      apiKey: 'k',
      approvals: POSTURE,
      withholdBuiltinShell: true,
    })('s2')
    expect(h.created[0]?.withheldBuiltinTools).toEqual(['shell'])

    h.created.length = 0
    await toAgentFactory(base().withholdBuiltinTools(['memory_get', 'shell']).build() as never, {
      apiKey: 'k',
      approvals: POSTURE,
      withholdBuiltinShell: true,
    })('s3')
    expect(h.created[0]?.withheldBuiltinTools).toEqual(['memory_get', 'shell'])
  })

  it('refuses an unknown builtin name with a ConfigurationError naming it', () => {
    const def = base()
      .withholdBuiltinTools(['nope' as never])
      .build()
    expect(() => assembleM8CreateOptions(def as never)).toThrow(ConfigurationError)
    expect(() => assembleM8CreateOptions(def as never)).toThrow(/nope/)
  })
})
