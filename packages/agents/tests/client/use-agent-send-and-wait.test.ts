import { runGoalLoop } from '@theokit/sdk'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { asGoalLoopAgent } from '../../src/client/goal-loop-agent.js'
import { useAgent, type UseAgentReturn } from '../../src/client/use-agent.js'

const turn = (text: string, hold?: Promise<void>): ReadableStream =>
  new ReadableStream({
    async start(c) {
      c.enqueue({ type: 'start' })
      c.enqueue({ type: 'text-start', id: 't' })
      c.enqueue({ type: 'text-delta', id: 't', delta: text })
      c.enqueue({ type: 'text-end', id: 't' })
      if (hold) await hold
      c.enqueue({ type: 'finish', messageMetadata: { usage: { totalTokens: 10 }, durationMs: 1 } })
      c.close()
    },
  })

function captureHook(transport: unknown): UseAgentReturn<string> {
  let captured: UseAgentReturn<string> | undefined
  function Probe() {
    captured = useAgent<string>(transport as never)
    return null
  }
  renderToString(createElement(Probe))
  if (!captured) throw new Error('hook did not render')
  return captured
}

describe('useAgent sendAndWait', () => {
  it('resolves with the settled status after the stream ends', async () => {
    let release!: () => void
    const hold = new Promise<void>((r) => (release = r))
    const hook = captureHook({ sendMessages: () => Promise.resolve(turn('hello', hold)) })
    let settled = false
    const p = hook.sendAndWait('hi').then((s) => {
      settled = true
      return s
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBe(false)
    release()
    expect(await p).toEqual({ status: 'done', text: 'hello', usage: { totalTokens: 10 } })
  })

  it('drives a goal loop through two turns with no consumer timer', async () => {
    vi.useFakeTimers()
    try {
      let n = 0
      const hook = captureHook({
        sendMessages: () => Promise.resolve(turn(`turn ${String(++n)}`)),
      })
      let judged = 0
      const gen = runGoalLoop(asGoalLoopAgent(hook), 'ship it', {}, {
        judge: () => {
          judged += 1
          return Promise.resolve(
            judged < 2
              ? { verdict: 'continue', reason: 'more', parseFailed: false }
              : { verdict: 'done', reason: 'ok', parseFailed: false },
          )
        },
      } as never)
      let step = await gen.next()
      while (!step.done) step = await gen.next()
      expect(n).toBe(2)
      expect(judged).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
