import { describe, expect, it } from 'vitest'

import type { TurnAgent } from '../src/agent-port.js'
import { leaseFrom } from '../src/triggers/event-agent.js'
import type { EventWithAgent } from '../src/triggers/event-agent.js'

const agent = {} as TurnAgent

describe('leaseFrom', () => {
  it('keeps the boundary open until release, and release resolves after the boundary has ended', async () => {
    const log: string[] = []
    const withAgent: EventWithAgent = async (work) => {
      const result = await work(agent)
      await Promise.resolve()
      log.push('disposed')
      return result
    }
    const lease = await leaseFrom(withAgent)()
    expect(lease.agent).toBe(agent)
    expect(log).toEqual([])
    await lease.release()
    expect(log).toEqual(['disposed'])
  })

  it('rejects when the boundary fails before it hands out an agent', async () => {
    const failure = new Error('no agent')
    await expect(leaseFrom(() => Promise.reject(failure))()).rejects.toBe(failure)
  })

  it('reports a teardown error through release only, with no unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const failure = new Error('teardown')
      const withAgent: EventWithAgent = async (work) => {
        await work(agent)
        throw failure
      }
      const lease = await leaseFrom(withAgent)()
      await expect(lease.release()).rejects.toBe(failure)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
