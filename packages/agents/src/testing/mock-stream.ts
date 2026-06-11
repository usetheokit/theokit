/**
 * createMockAgentStream — test agents without an LLM API key.
 *
 * Returns an AsyncIterable that yields typed SSE events in sequence,
 * simulating an agent conversation. Use in vitest/jest to test agent
 * wiring, tool call handling, and UI rendering without real LLM costs.
 *
 * @example
 * ```ts
 * import { createMockAgentStream } from '@theokit/agents/testing'
 *
 * const stream = createMockAgentStream({
 *   responses: [
 *     { type: 'text', content: 'Here are your tasks:' },
 *     { type: 'tool_call', name: 'tasks.list', input: {}, output: '[{"id":1}]' },
 *     { type: 'text', content: 'You have 1 task.' },
 *   ],
 * })
 *
 * const events = []
 * for await (const event of stream('hello', 'session-1')) {
 *   events.push(event)
 * }
 * // events: [run_started, text_delta, tool_call, tool_result, text_delta, done]
 * ```
 */

export interface MockResponse {
  type: 'text' | 'tool_call' | 'error'
  content?: string
  name?: string
  input?: unknown
  output?: string
  message?: string
}

export interface MockAgentStreamOptions {
  agentName?: string
  responses: MockResponse[]
  /** Simulated cost in USD (default: 0). */
  cost?: number
}

export interface MockStreamEvent {
  type: string
  [key: string]: unknown
}

export function createMockAgentStream(opts: MockAgentStreamOptions) {
  return (_message: string, _sessionId: string): AsyncIterable<MockStreamEvent> => ({
    async *[Symbol.asyncIterator]() {
      await Promise.resolve() // yield to event loop for async contract
      const runId = `mock-${Date.now()}`
      yield { type: 'run_started', runId, agentName: opts.agentName ?? 'mock-agent', model: 'mock' }

      let totalTokens = 0
      for (const r of opts.responses) {
        if (r.type === 'text' && r.content) {
          const words = r.content.split(' ')
          for (const word of words) {
            yield { type: 'text_delta', content: word + ' ' }
            totalTokens += 2
          }
        } else if (r.type === 'tool_call') {
          const callId = `tc-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`
          yield { type: 'tool_call', callId, toolName: r.name ?? 'unknown', input: r.input ?? {} }
          yield {
            type: 'tool_result',
            callId,
            toolName: r.name ?? 'unknown',
            output: r.output ?? '',
            durationMs: 0,
            isError: false,
          }
          totalTokens += 10
        } else if (r.type === 'error') {
          yield {
            type: 'error',
            code: 'MOCK_ERROR',
            message: r.message ?? 'Mock error',
            retryable: false,
          }
          return
        }
      }

      yield {
        type: 'done',
        result: opts.responses
          .filter((r) => r.type === 'text')
          .map((r) => r.content)
          .join(' '),
        usage: {
          inputTokens: totalTokens,
          outputTokens: totalTokens,
          totalTokens: totalTokens * 2,
        },
        durationMs: 0,
        cost: opts.cost ?? 0,
      }
    },
  })
}
