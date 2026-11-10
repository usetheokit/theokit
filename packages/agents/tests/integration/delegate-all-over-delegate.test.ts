/**
 * B-386 — `delegate_all` over compiled sub-agent specs, through the real `delegate()`. Only the run
 * itself is replaced (the reflective loop, the shape of `delegate-per-run-config.test.ts`), so the
 * roster check, `delegate()`'s key and budget handling and the per-task outcome all run for real.
 */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ started: [] as string[] }))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream: () => () => ({
    async *[Symbol.asyncIterator]() {
      yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    },
  }),
}))

vi.mock('../../src/loop/run-reflective-loop.js', () => ({
  runReflectiveLoop: async (_factory: unknown, message: string) => {
    h.started.push(message)
    // Yield once, so a sequential fan-out would show as one task finishing before the next starts.
    await Promise.resolve()
    return { response: `done: ${message}`, toolCalls: [], cost: 0, tokens: 0 }
  },
}))

const { createDelegateAllTool } = await import('../../src/tools-entry.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')

function spec(name: string) {
  return {
    name,
    compiled: applyCapabilities([new ModelCapability('decorator-model')]),
    strategy: 'react' as const,
    maxIterations: 2,
  }
}

describe('delegate_all over delegate()', () => {
  it('runs two compiled sub-agents and answers both in order', async () => {
    const tool = createDelegateAllTool({
      roster: [
        { name: 'reader', target: spec('Reader') },
        { name: 'writer', target: spec('Writer') },
      ],
      defaults: { apiKey: 'k' },
    })

    const answer = JSON.parse(
      String(
        await tool.handler({
          tasks: [
            { agent: 'reader', task: 'read a' },
            { agent: 'writer', task: 'summarise b' },
          ],
        }),
      ),
    ) as unknown

    expect(h.started).toEqual(['read a', 'summarise b'])
    expect(answer).toEqual({
      results: [
        { agent: 'reader', ok: true, response: 'done: read a' },
        { agent: 'writer', ok: true, response: 'done: summarise b' },
      ],
    })
  })

  it('refuses a spec roster without an api key at construction', () => {
    expect(() =>
      createDelegateAllTool({ roster: [{ name: 'reader', target: spec('Reader') }] }),
    ).toThrow(/createDelegateAllTool: a SubAgentSpec target requires defaults\.apiKey/)
  })
})
