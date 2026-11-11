import { describe, expect, it, vi } from 'vitest'

import type { TurnEvent, TurnRunner } from '../src/control-plane/turn.js'
import { webchatTurnFor } from '../src/webchat/session-commands.js'

function collect() {
  const events: TurnEvent[] = []
  const emit = (event: TurnEvent): void => void events.push(event)
  const text = (): string => events.map((e) => (e.type === 'text_delta' ? String(e.content) : '')).join('')
  return { emit, text }
}

function build(runner: TurnRunner) {
  const sent: { note: string; queueMode: unknown }[] = []
  const think = vi.fn()
  const compactRun = vi.fn(async () => ({ preTokens: 9, postTokens: 3 }))
  const turnFor = webchatTurnFor({
    model: 'm-1',
    runnerFor: () => runner,
    withChatAgent: async (_event, work) =>
      work({ agent: { send: async (note: string, o: { queueMode?: unknown }) => (sent.push({ note, queueMode: o.queueMode }), {}) }, agentId: 'a-1', release: () => undefined } as never),
    think,
    compact: { run: compactRun, write: () => undefined },
  })
  return { turnFor, sent, think, compactRun }
}

describe('WebChat slash commands', () => {
  it('answers /think, /compact and /status without a model turn', async () => {
    const runner = vi.fn<TurnRunner>()
    const { turnFor, think, compactRun } = build(runner)
    const run = turnFor('c1')
    const a = collect()
    expect(await run('/think high', a.emit)).toEqual({ ok: true })
    expect(a.text()).toBe('Thinking level set to high.')
    expect(think).toHaveBeenCalledWith(expect.anything(), 'high')
    const b = collect()
    await run('/think extreme', b.emit)
    expect(b.text()).toContain('Usage: /think')
    const c = collect()
    await run('/compact', c.emit)
    expect(c.text()).toContain('9 → 3')
    expect(compactRun).toHaveBeenCalledWith('a-1', 'manual')
    const d = collect()
    await run('/status', d.emit)
    expect(d.text()).toContain('Thinking: high')
    expect(runner).not.toHaveBeenCalled()
  })

  it('/stop cancels the running turn and /steer reaches it; both say so when nothing runs', async () => {
    let started!: () => void
    const running = new Promise<void>((r) => (started = r))
    const runner: TurnRunner = (_m, _e, signal) =>
      new Promise((resolve) => {
        started()
        signal?.addEventListener('abort', () => resolve({ ok: false, code: 'turn_cancelled', reason: 'stopped' }))
      })
    const { turnFor, sent } = build(runner)
    const run = turnFor('c1')
    const idle = collect()
    await run('/stop', idle.emit)
    expect(idle.text()).toBe('Nothing is running to stop.')
    const idleSteer = collect()
    await run('/steer go left', idleSteer.emit)
    expect(idleSteer.text()).toContain('Nothing is running')

    const turn = run('long task', collect().emit)
    await running
    const steer = collect()
    await run('/steer go left', steer.emit)
    expect(steer.text()).toBe('Steering the running turn.')
    expect(sent).toEqual([{ note: 'go left', queueMode: 'steer' }])
    const stop = collect()
    await run('/stop', stop.emit)
    expect(stop.text()).toBe('Stopped 1 running turn.')
    expect(await turn).toMatchObject({ ok: false, code: 'turn_cancelled' })
  })
})
