/**
 * V4-J — AgentRunner.stream()/run() accepts a per-run `opts.tools` override that
 * replaces the build-time `compiled.tools` for that call (theocode selects tools by
 * mode/permission per request). Backward-compatible: absent ⇒ compiled.tools.
 *
 * BDD: Given a built runner, When run() is called with opts.tools, Then the SDK
 * adapter receives the override; When called without, Then it receives compiled.tools.
 */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ capturedTools: null as unknown }))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    (_compiled: unknown, compiledTools: unknown) =>
    (
      _message: string,
      _sessionId: string,
    ): AsyncIterable<{ type: string; [k: string]: unknown }> => {
      h.capturedTools = compiledTools
      return (async function* () {
        yield { type: 'text_delta', content: 'ok' }
        yield { type: 'done' }
      })()
    },
}))

const { AgentRunner } = await import('../../src/index.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')

const bareAgent = applyCapabilities([new ModelCapability('test-model')])

const FAKE_TOOL = {
  name: 'override_tool',
  description: 'runtime-injected',
  inputSchema: {},
  handler: async () => 'r',
}

describe('V4-J runtime tool override on AgentRunner', () => {
  it('test_stream_uses_opts_tools_when_provided', async () => {
    h.capturedTools = null
    const runner = AgentRunner.fromSpec({
      compiled: bareAgent,
      agentName: 'bareAgent',
      strategy: 'simple-chat',
    }).build()
    await runner.run('go', { apiKey: 'k', tools: [FAKE_TOOL] as never })
    expect(h.capturedTools).toEqual([FAKE_TOOL])
  })

  it('test_stream_falls_back_to_compiled_tools_when_opts_tools_absent', async () => {
    h.capturedTools = null
    const runner = AgentRunner.fromSpec({
      compiled: bareAgent,
      agentName: 'bareAgent',
      strategy: 'simple-chat',
    }).build()
    await runner.run('go', { apiKey: 'k' })
    // bareAgent has no @Tool methods ⇒ compiled.tools === [] (NOT the override).
    expect(h.capturedTools).toEqual([])
  })
})
