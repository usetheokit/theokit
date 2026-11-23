import { describe, expect, it } from 'vitest'

import { FakeAgent } from '../../src/testing/index.js'

const text = (t: string) => ({ type: 'assistant', text: t })

describe('FakeAgent', () => {
  it('records sends and streams scripted frames', async () => {
    const agent = new FakeAgent({ frames: (t) => [text(t)] })
    const run = await agent.send('hi', { queueMode: 'steer' })
    const out: unknown[] = []
    for await (const f of run.stream()) out.push(f)
    expect(out).toEqual([text('hi')])
    expect(agent.sent).toEqual(['hi'])
    expect(agent.queueModes).toEqual(['steer'])
    expect(await run.wait()).toEqual({ status: 'finished' })
  })

  it('marks frames as already streamed after deltas', async () => {
    const run = await new FakeAgent({ frames: [text('a')], deltas: ['a'] }).send('x')
    const kinds: string[] = []
    for await (const e of run.events())
      kinds.push(e.kind === 'message' ? `m:${e.textAlreadyStreamed}` : e.kind)
    expect(kinds).toEqual(['delta', 'm:true'])
  })

  it('throws the stream error after its frames', async () => {
    const run = await new FakeAgent({ frames: [text('a')], streamError: new Error('boom') }).send(
      'x',
    )
    const seen: unknown[] = []
    await expect(
      (async () => {
        for await (const f of run.stream()) seen.push(f)
      })(),
    ).rejects.toThrow('boom')
    expect(seen).toHaveLength(1)
  })

  it('holds send on its gate', async () => {
    let open!: () => void
    const sendGate = new Promise<void>((r) => (open = r))
    const pending = new FakeAgent({ frames: [], sendGate }).send('x')
    let done = false
    void pending.then(() => (done = true))
    await new Promise((r) => setImmediate(r))
    expect(done).toBe(false)
    open()
    await pending
  })

  it('ends on abort and waits cancelled', async () => {
    const ac = new AbortController()
    const agent = new FakeAgent({ frames: [text('a')], before: new Promise<void>(() => undefined) })
    const run = await agent.send('x', { signal: ac.signal })
    const out: unknown[] = []
    const reading = (async () => {
      for await (const f of run.stream()) out.push(f)
    })()
    ac.abort()
    await reading
    expect(out).toEqual([])
    expect(await run.wait()).toEqual({ status: 'cancelled' })
    await run.cancel()
    expect(agent.cancels).toBe(1)
  })
})
