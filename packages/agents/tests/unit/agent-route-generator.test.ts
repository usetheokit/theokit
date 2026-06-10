import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import http from 'node:http'
import { z } from 'zod'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { compileAgent } from '../../src/bridge/agent-compiler.js'
import { generateAgentRoutes } from '../../src/bridge/agent-route-generator.js'
import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { nodeIncomingToRequest, writeResponseToNode } from '../../../http-decorators/src/bridge/runtime/node.js'

describe('agent-route-generator', () => {
  function setupAgent() {
    @Agent({ name: 'support', route: '/api/agents/support', model: 'claude-sonnet-4-5-20250929' })
    class SupportAgent {
      @MainLoop()
      async run() {}
    }

    const walk = walkAgentMetadata(SupportAgent)
    const compiled = compileAgent(walk)
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
      yield { type: 'done', result: 'Hello!', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, durationMs: 100 }
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
      expect(text).toContain('event: run_started')
      expect(text).toContain('event: text_delta')
      expect(text).toContain('event: done')
      expect(text).toContain('"agentName":"support"')
    } finally {
      server.close()
    }
  })
})
