import { describe, it, expect } from 'vitest'
import { streamAgentResponse, type StreamEvent } from '../../src/bridge/agent-sse-handler.js'

async function* mockStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const event of events) yield event
}

async function* errorStream(events: StreamEvent[], errorAt: number): AsyncGenerator<StreamEvent> {
  for (let i = 0; i < events.length; i++) {
    if (i === errorAt) throw new Error('Provider rate limited')
    yield events[i]
  }
}

async function readBody(response: Response): Promise<string> {
  return response.text()
}

describe('SSE handler (Web Standard Response)', () => {
  it('test_sse_headers', async () => {
    const response = streamAgentResponse(mockStream([]))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('connection')).toBe('keep-alive')
  })

  it('test_sse_event_format', async () => {
    const events: StreamEvent[] = [
      { type: 'system', agent_id: 'a1', run_id: 'r1' },
      { type: 'assistant', message: 'Hello' },
    ]

    const response = streamAgentResponse(mockStream(events))
    const output = await readBody(response)

    expect(output).toContain('event: system\n')
    expect(output).toContain('event: assistant\n')
    expect(output).toContain('"agent_id":"a1"')
    expect(output).toContain('"message":"Hello"')
    expect(output.split('\n\n').length).toBeGreaterThanOrEqual(2)
  })

  it('test_sse_error_mid_stream', async () => {
    const events: StreamEvent[] = [
      { type: 'system', data: 'ok' },
      { type: 'assistant', data: 'will-fail' },
    ]

    const response = streamAgentResponse(errorStream(events, 1))
    const output = await readBody(response)

    expect(output).toContain('event: system\n')
    expect(output).toContain('event: error\n')
    expect(output).toContain('Provider rate limited')
  })

  it('test_sse_large_event', async () => {
    const largeContent = 'x'.repeat(2_000_000)
    const events: StreamEvent[] = [
      { type: 'assistant', content: largeContent },
    ]

    const response = streamAgentResponse(mockStream(events))
    const output = await readBody(response)

    expect(output).toContain('event: assistant\n')
    expect(output.length).toBeGreaterThan(2_000_000)
  })

  it('test_sse_empty_stream', async () => {
    const response = streamAgentResponse(mockStream([]))
    const output = await readBody(response)
    expect(output).toBe('')
  })

  it('test_response_is_web_standard', () => {
    const response = streamAgentResponse(mockStream([]))
    expect(response).toBeInstanceOf(Response)
    expect(response.body).toBeDefined()
  })
})
