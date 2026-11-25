/**
 * B-376 — the TUI's frame adapter (`src/tui/frames.ts`): how a turn's control frames become the
 * `AgentStreamSource` that `@theokit/tui`'s `agentStreamReducer` folds, and which frame-level notices
 * TheoClaw adds and where they sit in the turn. Unit tests, no socket and no terminal.
 */
import { type AgentStreamEvent, agentStreamReducer, initialAgentStreamState } from '@theokit/tui'
import { createControlStreamInbox, createControlStreamSource } from '@theokit/agents/control'
import { describe, expect, it } from 'vitest'

import { deferred, waitFor } from './fakes.js'

import { type ControlClient, type ControlFrame, nextArrival } from '../src/control-client/control-client.js'
import { nextSessionId, type TuiNotice } from '../src/tui/frames.js'

const SESSION = 'owner'

/** One turn through the framework adapter, as the app builds it. */
function controlStream(
  client: ControlClient,
  text: string,
  session: string,
  onNotice: (n: TuiNotice) => void,
  onEnd: () => void,
  inbox = createControlStreamInbox({ stamp: nextArrival }),
) {
  return createControlStreamSource(client, session, text, { inbox, onNotice, onEnd })()
}

/** A turn event frame; the event's shape is the SDK translator's, so the test spells only its fields. */
function event(fields: Record<string, unknown>): ControlFrame {
  return { type: 'event', session: SESSION, event: fields } as unknown as ControlFrame
}

/** Run a turn's frames as the TUI does: the stream folds in the framework reducer, ending with its done. */
async function run(frames: readonly ControlFrame[], fail?: Error) {
  const notices: TuiNotice[] = []
  let ended = 0
  const client = {
    chat: async function* () {
      yield* frames
      if (fail !== undefined) throw fail
    },
  } as unknown as ControlClient
  const events: AgentStreamEvent[] = []
  for await (const e of controlStream(
    client,
    'hi',
    SESSION,
    (n) => notices.push(n),
    () => (ended += 1),
  ))
    events.push(e)
  const state = [...events, { type: 'done' }].reduce(agentStreamReducer, initialAgentStreamState)
  return { state, notices, ended, entries: state.events }
}

const DONE: ControlFrame = { type: 'done', session: SESSION }

describe('controlStream: text deltas', () => {
  it('joins consecutive deltas into one assistant message', async () => {
    const { state } = await run([
      event({ type: 'text_delta', content: 'Hel' }),
      event({ type: 'text_delta', content: 'lo' }),
      DONE,
    ])
    expect(state.events).toMatchObject([{ kind: 'message', role: 'assistant', text: 'Hello' }])
    expect(state.status).toBe('done')
  })

  it('starts a new assistant message after a tool card', async () => {
    const { state } = await run([
      event({ type: 'text_delta', content: 'one' }),
      event({ type: 'tool_call', callId: 'c1', toolName: 'ReadFile' }),
      event({ type: 'text_delta', content: 'two' }),
      DONE,
    ])
    expect(state.events).toMatchObject([
      { kind: 'message', text: 'one' },
      { kind: 'tool' },
      { kind: 'message', text: 'two' },
    ])
  })
})

describe('controlStream: tool cards', () => {
  it('draws a running card for a tool call (until the turn ends)', async () => {
    const client = {
      chat: async function* () {
        yield event({ type: 'tool_call', callId: 'c1', toolName: 'ReadFile' })
      },
    } as unknown as ControlClient
    const first = await controlStream(
      client,
      'hi',
      SESSION,
      () => undefined,
      () => undefined,
    ).next()
    expect(
      agentStreamReducer(initialAgentStreamState, first.value as AgentStreamEvent).events,
    ).toMatchObject([{ kind: 'tool', name: 'ReadFile', status: 'running' }])
  })

  it('settles the matching card as success, leaving the other card running', async () => {
    const client = {
      chat: async function* () {
        yield event({ type: 'tool_call', callId: 'c1', toolName: 'ReadFile' })
        yield event({ type: 'tool_call', callId: 'c2', toolName: 'Grep' })
        yield event({ type: 'tool_result', callId: 'c1', isError: false })
      },
    } as unknown as ControlClient
    let state = initialAgentStreamState
    for await (const e of controlStream(
      client,
      'hi',
      SESSION,
      () => undefined,
      () => undefined,
    ))
      state = agentStreamReducer(state, e)
    expect(state.events).toMatchObject([
      { kind: 'tool', name: 'ReadFile', status: 'success' },
      { kind: 'tool', name: 'Grep', status: 'running' },
    ])
  })

  it('settles a card as failed only when the result says isError: true', async () => {
    const { state } = await run([
      event({ type: 'tool_call', callId: 'c1', toolName: 'ReadFile' }),
      event({ type: 'tool_call', callId: 'c2', toolName: 'Grep' }),
      event({ type: 'tool_result', callId: 'c1', isError: true }),
      event({ type: 'tool_result', callId: 'c2', isError: false }),
      DONE,
    ])
    expect(state.events).toMatchObject([
      { kind: 'tool', name: 'ReadFile', status: 'failed' },
      { kind: 'tool', name: 'Grep', status: 'success' },
    ])
  })

  it('ignores a result whose call id matches no card', async () => {
    const { state } = await run([
      event({ type: 'tool_call', callId: 'c1', toolName: 'ReadFile' }),
      event({ type: 'tool_result', callId: 'c1', isError: false }),
      event({ type: 'tool_result', callId: 'missing', isError: true }),
      DONE,
    ])
    expect(state.events).toHaveLength(1)
    expect(state.events[0]).toMatchObject({ name: 'ReadFile', status: 'success' })
  })
})

describe('controlStream: the end of a turn', () => {
  it('done ends the turn and keeps the text', async () => {
    const { state, notices, ended } = await run([
      event({ type: 'text_delta', content: 'hi' }),
      DONE,
    ])
    expect(state.events).toMatchObject([{ text: 'hi' }])
    expect(notices).toEqual([])
    expect(ended).toBe(1)
  })

  it('interrupted ends the turn with the framework notice after the partial output, cancelling the unfinished tool', async () => {
    const { entries, state, ended } = await run([
      event({ type: 'text_delta', content: 'part' }),
      event({ type: 'tool_call', callId: 'c1', toolName: 'ReadFile' }),
      { type: 'interrupted', session: SESSION },
    ])
    expect(entries).toMatchObject([
      { kind: 'message', text: 'part' },
      { kind: 'tool', name: 'ReadFile', status: 'cancelled' },
      { kind: 'notice', variant: 'warning', text: 'Interrupted by user' },
    ])
    expect(state.status).toBe('interrupted')
    expect(ended).toBe(1)
  })

  it('interrupted cancels only the tool still running; a settled one keeps its status', async () => {
    const { entries } = await run([
      event({ type: 'tool_call', callId: 'c1', toolName: 'ReadFile' }),
      event({ type: 'tool_call', callId: 'c2', toolName: 'Grep' }),
      event({ type: 'tool_result', callId: 'c1', isError: false }),
      { type: 'interrupted', session: SESSION },
    ])
    expect(entries).toMatchObject([
      { kind: 'tool', name: 'ReadFile', status: 'success' },
      { kind: 'tool', name: 'Grep', status: 'cancelled' },
      { kind: 'notice', text: 'Interrupted by user' },
    ])
  })

  it('an error frame ends the turn with an error line naming its code', async () => {
    const { entries } = await run([{ type: 'error', code: 'busy', session: SESSION }])
    expect(entries).toMatchObject([{ kind: 'notice', variant: 'error', text: 'the turn ended: busy' }])
  })

  it('an error event inside the turn adds an error line in place and the turn goes on', async () => {
    const { entries, state } = await run([
      event({ type: 'text_delta', content: 'before' }),
      event({ type: 'error', code: 'rate_limited' }),
      event({ type: 'text_delta', content: 'after' }),
      DONE,
    ])
    expect(entries).toMatchObject([
      { kind: 'message', text: 'before' },
      { kind: 'notice', variant: 'error', text: 'the turn failed (rate_limited)' },
      { kind: 'message', text: 'after' },
    ])
    expect(state.status).toBe('done')
  })

  it('a failed connection ends the turn with the reason as an error line', async () => {
    const { entries, ended } = await run([], new Error('connection closed before the turn ended'))
    expect(entries).toMatchObject([
      { kind: 'notice', variant: 'error', text: 'connection closed before the turn ended' },
    ])
    expect(ended).toBe(1)
  })

  it('draws nothing for interrupt_ok, no_turn and an unknown event type', async () => {
    const { state, notices } = await run([
      { type: 'interrupt_ok', session: SESSION },
      { type: 'no_turn', session: SESSION },
      event({ type: 'usage', tokens: 12 }),
      DONE,
    ])
    expect(state.events).toEqual([])
    expect(notices).toEqual([])
  })
})

describe('nextSessionId', () => {
  it('appends -n to a short base', () => {
    expect(nextSessionId('owner', 2)).toBe('owner-2')
  })

  it('keeps a 64-character base within the 64-character limit by shortening the base', () => {
    const id = nextSessionId('a'.repeat(64), 12)
    expect(id).toHaveLength(64)
    expect(id.endsWith('-12')).toBe(true)
  })

  it('leaves a base that fits exactly with its suffix unshortened', () => {
    const base = 'b'.repeat(62)
    expect(nextSessionId(base, 3)).toBe(`${base}-3`)
  })
})

describe('controlStream: notices from the app', () => {
  it('a notice posted mid-turn is placed when posted, so text received before and after it sits on each side', async () => {
    const gate = deferred<void>()
    const gate2 = deferred<void>()
    const client = {
      chat: async function* () {
        yield event({ type: 'text_delta', content: 'before' })
        await gate.promise
        yield event({ type: 'text_delta', content: 'after' })
        await gate2.promise
        yield DONE
      },
    } as unknown as ControlClient
    const inbox = createControlStreamInbox({ stamp: nextArrival })
    const notices: TuiNotice[] = []
    const events: AgentStreamEvent[] = []
    const consume = (async () => {
      for await (const e of controlStream(
        client,
        'hi',
        SESSION,
        (n) => notices.push(n),
        () => undefined,
        inbox,
      ))
        events.push(e)
    })()
    await waitFor(() => events.length === 1, 2000, 'the first delta')
    inbox.post({ variant: 'warning', text: 'queued' })
    await waitFor(() => events.length === 2, 2000, 'the notice to be placed')
    gate.resolve()
    gate2.resolve()
    await consume
    const state = [...events, { type: 'done' } as AgentStreamEvent].reduce(
      agentStreamReducer,
      initialAgentStreamState,
    )
    expect(state.events).toMatchObject([
      { kind: 'message', text: 'before' },
      { kind: 'notice', text: 'queued' },
      { kind: 'message', text: 'after' },
    ])
  })

  it('a notice posted after frames arrived is placed after all of them, however late the stream resumes', async () => {
    for (const frames of [
      [event({ type: 'text_delta', content: 'a' }), event({ type: 'text_delta', content: 'b' })],
      [
        event({ type: 'tool_call', callId: 'c1', toolName: 'ReadFile' }),
        event({ type: 'tool_call', callId: 'c2', toolName: 'Grep' }),
      ],
    ]) {
      // Both frames reach the client at once; the consumer is busy with the first when the warning is posted.
      const client = {
        chat: async function* () {
          yield* frames
          yield DONE
        },
      } as unknown as ControlClient
      const inbox = createControlStreamInbox({ stamp: nextArrival })
      const notices: TuiNotice[] = []
      const stream = controlStream(
        client,
        'hi',
        SESSION,
        (n) => notices.push(n),
        () => undefined,
        inbox,
      )
      const events: AgentStreamEvent[] = [(await stream.next()).value as AgentStreamEvent]
      await new Promise((resolve) => setTimeout(resolve, 20))
      inbox.post({ variant: 'warning', text: 'late' })
      for await (const e of stream) events.push(e)
      const state = [...events, { type: 'done' } as AgentStreamEvent].reduce(
        agentStreamReducer,
        initialAgentStreamState,
      )
      // The frames had all arrived, so the notice is placed after them: once the stream ended, below the turn.
      expect(state.events.some((e) => e.kind === 'notice')).toBe(false)
      expect(notices).toEqual([{ variant: 'warning', text: 'late' }])
    }
  })

  it('a notice posted before a frame resolves in the same tick is placed before that frame', async () => {
    const gate = deferred<void>()
    const client = {
      chat: async function* () {
        yield event({ type: 'text_delta', content: 'before' })
        await gate.promise
        yield event({ type: 'text_delta', content: 'after' })
        yield DONE
      },
    } as unknown as ControlClient
    const inbox = createControlStreamInbox({ stamp: nextArrival })
    const notices: TuiNotice[] = []
    const stream = controlStream(client, 'hi', SESSION, (n) => notices.push(n), () => undefined, inbox)
    const events: AgentStreamEvent[] = [(await stream.next()).value as AgentStreamEvent]
    inbox.post({ variant: 'warning', text: 'queued' })
    gate.resolve()
    for await (const e of stream) events.push(e)
    const state = [...events, { type: 'done' } as AgentStreamEvent].reduce(
      agentStreamReducer,
      initialAgentStreamState,
    )
    expect(state.events).toMatchObject([
      { kind: 'message', text: 'before' },
      { kind: 'notice', text: 'queued' },
      { kind: 'message', text: 'after' },
    ])
  })

  it('a frame that arrived before a notice posted in the same tick is placed before it', async () => {
    const gate = deferred<void>()
    let arrivedAt = 0
    const client = {
      chat: async function* () {
        yield event({ type: 'text_delta', content: 'before' })
        await gate.promise
        yield { ...event({ type: 'text_delta', content: 'after' }), arrivedAt } as ControlFrame
        yield DONE
      },
    } as unknown as ControlClient
    const inbox = createControlStreamInbox({ stamp: nextArrival })
    const notices: TuiNotice[] = []
    const stream = controlStream(client, 'hi', SESSION, (n) => notices.push(n), () => undefined, inbox)
    const events: AgentStreamEvent[] = [(await stream.next()).value as AgentStreamEvent]
    // The frame comes off the socket (stamped), then the notice is posted, before the consumer resumes.
    arrivedAt = nextArrival()
    gate.resolve()
    inbox.post({ variant: 'warning', text: 'queued' })
    for await (const e of stream) events.push(e)
    const state = [...events, { type: 'done' } as AgentStreamEvent].reduce(
      agentStreamReducer,
      initialAgentStreamState,
    )
    expect(state.events).toMatchObject([
      { kind: 'message', text: 'beforeafter' },
      { kind: 'notice', text: 'queued' },
    ])
  })

  it('an interrupted frame that arrived before a notice posted in the same tick puts the interruption first and the notice below the turn', async () => {
    const gate = deferred<void>()
    let arrivedAt = 0
    const client = {
      chat: async function* () {
        yield event({ type: 'text_delta', content: 'part' })
        await gate.promise
        yield { type: 'interrupted', session: SESSION, arrivedAt } as ControlFrame
      },
    } as unknown as ControlClient
    const inbox = createControlStreamInbox({ stamp: nextArrival })
    const below: TuiNotice[] = []
    const stream = controlStream(client, 'hi', SESSION, (n) => below.push(n), () => undefined, inbox)
    const events: AgentStreamEvent[] = [(await stream.next()).value as AgentStreamEvent]
    arrivedAt = nextArrival()
    gate.resolve()
    inbox.post({ variant: 'warning', text: 'queued' })
    for await (const e of stream) events.push(e)
    const state = events.reduce(agentStreamReducer, initialAgentStreamState)
    expect(state.events).toMatchObject([
      { kind: 'message', text: 'part' },
      { kind: 'notice', text: 'Interrupted by user' },
    ])
    expect(below).toEqual([{ variant: 'warning', text: 'queued' }])
  })

  it('a notice posted before the interrupted frame resolves is placed before the interruption', async () => {
    const gate = deferred<void>()
    const client = {
      chat: async function* () {
        yield event({ type: 'text_delta', content: 'part' })
        await gate.promise
        yield { type: 'interrupted', session: SESSION } as ControlFrame
      },
    } as unknown as ControlClient
    const inbox = createControlStreamInbox({ stamp: nextArrival })
    const stream = controlStream(client, 'hi', SESSION, () => undefined, () => undefined, inbox)
    const events: AgentStreamEvent[] = [(await stream.next()).value as AgentStreamEvent]
    inbox.post({ variant: 'warning', text: 'queued' })
    gate.resolve()
    for await (const e of stream) events.push(e)
    const state = events.reduce(agentStreamReducer, initialAgentStreamState)
    expect(state.events).toMatchObject([
      { kind: 'message', text: 'part' },
      { kind: 'notice', text: 'queued' },
      { kind: 'notice', text: 'Interrupted by user' },
    ])
  })

  it('a notice posted while the interrupted frame waits for the consumer is drawn below the turn', async () => {
    const gate = deferred<void>()
    const client = {
      chat: async function* () {
        yield event({ type: 'text_delta', content: 'part' })
        await gate.promise
        yield { type: 'interrupted', session: SESSION } as ControlFrame
      },
    } as unknown as ControlClient
    const inbox = createControlStreamInbox({ stamp: nextArrival })
    const below: TuiNotice[] = []
    const stream = controlStream(client, 'hi', SESSION, (n) => below.push(n), () => undefined, inbox)
    await stream.next()
    gate.resolve()
    await new Promise((resolve) => setTimeout(resolve, 20))
    inbox.post({ variant: 'warning', text: 'queued' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    for await (const e of stream) void e
    expect(below).toEqual([{ variant: 'warning', text: 'queued' }])
  })
})
