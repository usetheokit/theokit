import { describe, expect, it } from 'vitest'

import type { TurnAgent, TurnRun } from '../src/agent-port.js'
import { parseFallbackModel, parseThinkingLevel, withFailover } from '../src/agent/failover.js'

function run(messages: string[], status: string): TurnRun {
  return {
    async *stream() {
      for (const type of messages) yield { type }
    },
    wait: async () => ({ status }),
    cancel: async () => {},
  }
}

async function drain(turn: TurnRun): Promise<string[]> {
  const seen: string[] = []
  for await (const item of turn.stream()) seen.push(item.type)
  return seen
}

describe('failover between providers (OC-47)', () => {
  it('a primary whose send throws falls over to the secondary in the same turn', async () => {
    const primary: TurnAgent = { send: () => Promise.reject(new Error('provider down')) }
    const secondary: TurnAgent = { send: async () => run(['assistant'], 'finished') }
    const turn = await withFailover(primary, async () => secondary).send('hi')
    expect(await drain(turn)).toEqual(['assistant'])
    expect((await turn.wait()).status).toBe('finished')
  })

  it('a primary run that fails with no output falls over, and the secondary result is the turn', async () => {
    const sent: unknown[] = []
    const primary: TurnAgent = { send: async () => run([], 'failed') }
    const secondary: TurnAgent = { send: async (message) => (sent.push(message), run(['assistant'], 'finished')) }
    const turn = await withFailover(primary, async () => secondary).send('hello')
    expect(await drain(turn)).toEqual(['assistant'])
    expect(sent).toEqual(['hello'])
    expect((await turn.wait()).status).toBe('finished')
  })

  it('a primary that already streamed stays the turn and the secondary is never built', async () => {
    let built = false
    const primary: TurnAgent = { send: async () => run(['assistant'], 'failed') }
    const turn = await withFailover(primary, async () => ((built = true), primary)).send('x')
    expect(await drain(turn)).toEqual(['assistant'])
    expect(built).toBe(false)
    expect((await turn.wait()).status).toBe('failed')
  })
})

describe('provider settings', () => {
  it('reads the thinking level and the fallback model', () => {
    expect(parseThinkingLevel(undefined)).toBeUndefined()
    expect(parseThinkingLevel(' High ')).toBe('high')
    expect(() => parseThinkingLevel('max')).toThrow('THEOCLAW_THINKING')
    expect(parseFallbackModel('  ')).toBeUndefined()
    expect(parseFallbackModel(' b/model ')).toBe('b/model')
  })
})
