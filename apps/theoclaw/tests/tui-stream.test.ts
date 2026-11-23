/**
 * B-376 — the TUI's frame adapter (`src/tui/frames.ts`): how a turn's control frames become the stream
 * `AgentSession` runs, and where Esc (the abort signal) reaches the instance. Unit tests, no socket.
 */
import { type AgentStreamEvent, agentStreamReducer, initialAgentStreamState } from '@theokit/tui'
import { describe, expect, it } from 'vitest'

import type { ControlClient, ControlFrame } from '../src/control-client/control-client.js'
import { controlStream } from '../src/tui/frames.js'

const SESSION = 'owner'

function event(fields: Record<string, unknown>): ControlFrame {
  return { type: 'event', session: SESSION, event: fields } as unknown as ControlFrame
}

const DONE: ControlFrame = { type: 'done', session: SESSION }

async function run(frames: readonly ControlFrame[], fail?: Error) {
  const interrupts: string[] = []
  const client = {
    chat: async function* () {
      yield* frames
      if (fail !== undefined) throw fail
    },
    interrupt: (session: string) => interrupts.push(session),
  } as unknown as ControlClient
  const controller = new AbortController()
  const events: AgentStreamEvent[] = []
  for await (const e of controlStream(client, 'hi', SESSION, controller.signal)) events.push(e)
  const state = [...events, { type: 'done' }].reduce(agentStreamReducer, initialAgentStreamState)
  return { events, state, interrupts, controller }
}

describe('controlStream', () => {
  it('joins consecutive deltas into one assistant message', async () => {
    const { state } = await run([
      event({ type: 'text_delta', content: 'Hel' }),
      event({ type: 'text_delta', content: 'lo' }),
      DONE,
    ])
    expect(state.events).toMatchObject([{ kind: 'message', role: 'assistant', text: 'Hello' }])
  })

  it('draws a tool call and settles it by its result', async () => {
    const { state } = await run([
      event({ type: 'tool_call', callId: 'c1', toolName: 'lookup' }),
      event({ type: 'tool_result', callId: 'c1', isError: false }),
      DONE,
    ])
    expect(state.events).toMatchObject([{ kind: 'tool', name: 'lookup', status: 'success' }])
  })

  it('fails a tool whose result is an error and ignores a result with no call', async () => {
    const { state } = await run([
      event({ type: 'tool_call', callId: 'c1', toolName: 'lookup' }),
      event({ type: 'tool_result', callId: 'c1', isError: true }),
      event({ type: 'tool_result', callId: 'ghost' }),
      DONE,
    ])
    expect(state.events).toHaveLength(1)
    expect(state.events[0]).toMatchObject({ kind: 'tool', status: 'failed' })
  })

  it('turns an error event inside the turn into a notice and keeps going', async () => {
    const { state } = await run([
      event({ type: 'text_delta', content: 'a' }),
      event({ type: 'error', code: 'boom' }),
      event({ type: 'text_delta', content: 'b' }),
      DONE,
    ])
    expect(state.events.map((e) => e.kind)).toEqual(['message', 'notice', 'message'])
    expect(state.events[1]).toMatchObject({ variant: 'error', text: 'the turn failed (boom)' })
  })

  it('ends at an error frame with a notice, and at interrupted without one', async () => {
    const failed = await run([{ type: 'error', session: SESSION, code: 'limit' } as ControlFrame])
    expect(failed.state.events).toMatchObject([{ kind: 'notice', text: 'the turn ended: limit' }])
    const stopped = await run([{ type: 'interrupted', session: SESSION } as ControlFrame])
    expect(stopped.events).toEqual([])
  })

  it('reports a failed connection as an error notice', async () => {
    const { state } = await run([], new Error('socket closed'))
    expect(state.events).toMatchObject([{ kind: 'notice', variant: 'error', text: 'socket closed' }])
  })

  it('sends the instance an interrupt for the session when the signal aborts', async () => {
    const interrupts: string[] = []
    const client = {
      chat: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }),
      }),
      interrupt: (session: string) => interrupts.push(session),
    } as unknown as ControlClient
    const controller = new AbortController()
    const iterator = controlStream(client, 'hi', SESSION, controller.signal)
    void iterator.next()
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    expect(interrupts).toEqual([SESSION])
  })
})
