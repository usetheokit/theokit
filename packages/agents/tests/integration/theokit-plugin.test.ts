import 'reflect-metadata'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { describe, it, expect } from 'vitest'
import http from 'node:http'
import { agentsPlugin } from '../../src/theokit-plugin.js'
import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { nodeIncomingToRequest, writeResponseToNode } from '@theokit/http/runtime/node'

const testAgent = {
  name: 'test',
  route: '/api/agents/test',
  compiled: applyCapabilities([new ModelCapability('mock')]),
}

/** Wrap agent plugin hooks behind a Node HTTP server for testing. */
function createPluginServer(hooks: Function[], fallbackHandler?: (request: Request) => Response) {
  return http.createServer(async (nodeReq, nodeRes) => {
    const request = nodeIncomingToRequest(nodeReq)

    for (const hook of hooks) {
      const response = await (hook as (ctx: { request: Request }) => Promise<Response | undefined>)(
        { request },
      )
      if (response instanceof Response) {
        await writeResponseToNode(response, nodeRes)
        return
      }
    }

    // Fallback
    const fallback = fallbackHandler
      ? fallbackHandler(request)
      : new Response('{}', { status: 404 })
    await writeResponseToNode(fallback, nodeRes)
  })
}

describe('agentsPlugin()', () => {
  it('test_plugin_registers_hook', () => {
    const plugin = agentsPlugin({ agents: [testAgent] })
    expect(plugin.name).toBe('@theokit/agents')

    let hookName = ''
    plugin.register({
      addHook(name: string, _fn: Function) {
        hookName = name
      },
    })
    expect(hookName).toBe('onRequest')
  })

  it('test_plugin_routes_agent_chat', async () => {
    const mockStream = async function* (): AsyncGenerator<StreamEvent> {
      yield { type: 'run_started', runId: 'r1', agentName: 'test-agent' }
      yield { type: 'text_delta', content: 'Hi from agent!' }
      yield {
        type: 'done',
        result: 'Hi!',
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        durationMs: 50,
      }
    }

    const plugin = agentsPlugin({
      agents: [testAgent],
      createRunFactory: () => () => mockStream(),
    })

    const hooks: Function[] = []
    plugin.register({
      addHook(_name: string, fn: Function) {
        hooks.push(fn)
      },
    })

    const server = createPluginServer(hooks)
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as { port: number }).port

    try {
      const res = await fetch(`http://localhost:${port}/api/agents/test/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream')

      const text = await res.text()
      expect(text).toContain('event: text_delta')
      expect(text).toContain('Hi from agent!')
    } finally {
      server.close()
    }
  })

  it('test_plugin_falls_through_non_agent_routes', async () => {
    const plugin = agentsPlugin({ agents: [testAgent] })

    const hooks: Function[] = []
    plugin.register({
      addHook(_name: string, fn: Function) {
        hooks.push(fn)
      },
    })

    const server = createPluginServer(
      hooks,
      () =>
        new Response(JSON.stringify({ controller: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as { port: number }).port

    try {
      const res = await fetch(`http://localhost:${port}/api/users`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { controller: boolean }
      expect(body.controller).toBe(true)
    } finally {
      server.close()
    }
  })

  it('test_plugin_default_factory_returns_sdk_not_wired', async () => {
    const plugin = agentsPlugin({ agents: [testAgent] })

    const hooks: Function[] = []
    plugin.register({
      addHook(_name: string, fn: Function) {
        hooks.push(fn)
      },
    })

    const server = createPluginServer(hooks)
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as { port: number }).port

    try {
      const res = await fetch(`http://localhost:${port}/api/agents/test/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      })

      const text = await res.text()
      expect(text).toContain('SDK_NOT_WIRED')
    } finally {
      server.close()
    }
  })
})
