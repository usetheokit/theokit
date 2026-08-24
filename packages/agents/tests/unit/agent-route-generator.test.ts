import { describe, it, expect } from 'vitest'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import http from 'node:http'
import { generateAgentRoutes } from '../../src/bridge/agent-route-generator.js'
import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { nodeIncomingToRequest, writeResponseToNode } from '@theokit/http/runtime/node'

describe('agent-route-generator', () => {
  function setupAgent() {
    // `route` is the generator's only input besides the compiled options (M53 § C narrowed it).
    const walk = { route: '/api/agents/support' }
    const compiled = applyCapabilities([new ModelCapability('claude-sonnet-4-5-20250929')])
    return { walk, compiled }
  }

  /** Wrap a Web Standard handler behind a Node.js HTTP server for testing. */
  function createTestServer(handler: (request: Request) => Promise<Response>) {
    return http.createServer(async (nodeReq, nodeRes) => {
      const request = nodeIncomingToRequest(nodeReq)
      const response = await handler(request)
      await writeResponseToNode(response, nodeRes)
    })
  }

  it('test_generates_chat_route', () => {
    const { walk, compiled } = setupAgent()

    const routes = generateAgentRoutes({
      walkResult: walk,
      compiledOptions: compiled,
      createRun: async function* () {},
    })

    expect(routes.length).toBeGreaterThanOrEqual(1)
    expect(routes[0].method).toBe('POST')
    expect(routes[0].path).toBe('/api/agents/support/chat')
  })

  it('test_generates_runs_route_when_getRun_provided', () => {
    const { walk, compiled } = setupAgent()

    const routes = generateAgentRoutes({
      walkResult: walk,
      compiledOptions: compiled,
      createRun: async function* () {},
      getRun: async (id) => ({ id, status: 'finished', result: 'done' }),
    })

    expect(routes).toHaveLength(2)
    expect(routes[1].method).toBe('GET')
    expect(routes[1].path).toBe('/api/agents/support/runs/:runId')
  })

  it('test_chat_route_requires_message', async () => {
    const { walk, compiled } = setupAgent()

    const routes = generateAgentRoutes({
      walkResult: walk,
      compiledOptions: compiled,
      createRun: async function* () {},
    })

    const server = createTestServer(routes[0].handler)
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as { port: number }).port

    try {
      const r1 = await fetch(`http://localhost:${port}/api/agents/support/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      expect(r1.status).toBe(400)

      const r2 = await fetch(`http://localhost:${port}/api/agents/support/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      })
      expect(r2.status).toBe(200)
      expect(r2.headers.get('content-type')).toBe('text/event-stream')
    } finally {
      server.close()
    }
  })

  it('test_chat_route_streams_events', async () => {
    const { walk, compiled } = setupAgent()

    const mockCreateRun = async function* (): AsyncGenerator<StreamEvent> {
      yield { type: 'run_started', runId: 'run-1', agentName: 'support' }
      yield { type: 'text_delta', content: 'Hello!' }
      yield {
        type: 'done',
        result: 'Hello!',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        durationMs: 100,
      }
    }

    const routes = generateAgentRoutes({
      walkResult: walk,
      compiledOptions: compiled,
      createRun: () => mockCreateRun(),
    })

    const server = createTestServer(routes[0].handler)
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as { port: number }).port

    try {
      const res = await fetch(`http://localhost:${port}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Hi' }),
      })

      const text = await res.text()

      // #386 — this asserted the FRAMEWORK vocabulary (`event: run_started`, `event: text_delta`,
      // `"agentName":"support"`), which is a wire none of this framework's clients can read:
      // `parseWireStream` validates each `data:` payload against `wireChunkSchema` and silently
      // discards what fails. The route speaks the shipped wire now, so the test asserts that a
      // client would actually receive the turn.
      const payloads = text
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice('data: '.length))

      const { wireChunkSchema } = await import('@theokit/presenter/wire')
      const chunks = payloads
        .filter((p) => p !== '[DONE]')
        .map((p) => JSON.parse(p) as { type: string; delta?: string })
      for (const chunk of chunks) {
        expect(wireChunkSchema.safeParse(chunk).success, `unreadable frame: ${chunk.type}`).toBe(
          true,
        )
      }

      expect(chunks.map((c) => c.type)).toContain('text-delta')
      expect(chunks.some((c) => c.delta === 'Hello!')).toBe(true)
      // Terminated, so a completed run is distinguishable from a dropped connection (#384).
      expect(chunks.map((c) => c.type)).toContain('finish')
      expect(payloads.at(-1)).toBe('[DONE]')
    } finally {
      server.close()
    }
  })
})
