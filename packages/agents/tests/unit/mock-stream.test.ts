import { describe, it, expect } from 'vitest'
import { createMockAgentStream } from '../../src/testing/mock-stream.js'

async function collect(stream: AsyncIterable<{ type: string; [k: string]: unknown }>) {
  const events: { type: string; [k: string]: unknown }[] = []
  for await (const e of stream) events.push(e)
  return events
}

describe('createMockAgentStream', () => {
  it('yields run_started as first event', async () => {
    const factory = createMockAgentStream({ responses: [] })
    const events = await collect(factory('hi', 's1'))
    expect(events[0].type).toBe('run_started')
    expect(events[0].agentName).toBe('mock-agent')
  })

  it('custom agentName', async () => {
    const factory = createMockAgentStream({ agentName: 'planner', responses: [] })
    const events = await collect(factory('hi', 's1'))
    expect(events[0].agentName).toBe('planner')
  })

  it('text response yields text_delta events word by word', async () => {
    const factory = createMockAgentStream({
      responses: [{ type: 'text', content: 'Hello world' }],
    })
    const events = await collect(factory('hi', 's1'))
    const deltas = events.filter(e => e.type === 'text_delta')
    expect(deltas).toHaveLength(2)
    expect(deltas[0].content).toBe('Hello ')
    expect(deltas[1].content).toBe('world ')
  })

  it('tool_call yields tool_call + tool_result', async () => {
    const factory = createMockAgentStream({
      responses: [{ type: 'tool_call', name: 'tasks.list', input: {}, output: '[]' }],
    })
    const events = await collect(factory('hi', 's1'))
    const calls = events.filter(e => e.type === 'tool_call')
    const results = events.filter(e => e.type === 'tool_result')
    expect(calls).toHaveLength(1)
    expect(calls[0].toolName).toBe('tasks.list')
    expect(results).toHaveLength(1)
    expect(results[0].output).toBe('[]')
  })

  it('error response stops the stream', async () => {
    const factory = createMockAgentStream({
      responses: [
        { type: 'error', message: 'rate limited' },
        { type: 'text', content: 'should not appear' },
      ],
    })
    const events = await collect(factory('hi', 's1'))
    const errors = events.filter(e => e.type === 'error')
    const dones = events.filter(e => e.type === 'done')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('rate limited')
    expect(dones).toHaveLength(0) // stopped before done
  })

  it('done is last event with usage stats', async () => {
    const factory = createMockAgentStream({
      responses: [{ type: 'text', content: 'ok' }],
    })
    const events = await collect(factory('hi', 's1'))
    const done = events[events.length - 1]
    expect(done.type).toBe('done')
    expect(done.usage).toBeDefined()
    expect((done.usage as { totalTokens: number }).totalTokens).toBeGreaterThan(0)
  })

  it('custom cost flows to done event', async () => {
    const factory = createMockAgentStream({
      responses: [{ type: 'text', content: 'ok' }],
      cost: 0.005,
    })
    const events = await collect(factory('hi', 's1'))
    const done = events.find(e => e.type === 'done')!
    expect(done.cost).toBe(0.005)
  })

  it('multiple responses in sequence', async () => {
    const factory = createMockAgentStream({
      responses: [
        { type: 'text', content: 'Checking tasks' },
        { type: 'tool_call', name: 'tasks.list', input: {}, output: '[{"id":1}]' },
        { type: 'text', content: 'Found 1 task' },
      ],
    })
    const events = await collect(factory('list tasks', 's1'))
    const types = events.map(e => e.type)
    expect(types).toContain('run_started')
    expect(types).toContain('text_delta')
    expect(types).toContain('tool_call')
    expect(types).toContain('tool_result')
    expect(types[types.length - 1]).toBe('done')
  })

  it('message and sessionId are accepted but ignored', async () => {
    const factory = createMockAgentStream({ responses: [] })
    // Should not throw regardless of input
    const events = await collect(factory('any message', 'any-session'))
    expect(events.length).toBeGreaterThanOrEqual(2) // run_started + done
  })
})
