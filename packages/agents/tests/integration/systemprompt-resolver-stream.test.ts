/**
 * V4-L.1 wiring proof — a resolver authored on `@Agent` reaches the SDK
 * `Agent.create` call unchanged (byref) through `createSdkAgentStream`, for a
 * non-`@ProjectContext` agent (the base-resolver `else if` branch at
 * sdk-adapter.ts:52-54). Backward compat: a string systemPrompt arrives byvalue.
 *
 * BDD: Given a compiled agent whose systemPrompt is a resolver, When the stream is
 * driven, Then the SDK Agent.create receives that exact resolver reference.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import type { SystemPromptResolver } from '@theokit/sdk'

import { createSdkAgentStream } from '../../src/bridge/sdk-adapter.js'
import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'

interface CapturedCreate {
  systemPrompt?: unknown
}
const h = vi.hoisted(() => ({ captured: null as CapturedCreate | null }))

vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  Agent: {
    getOrCreate: vi.fn(async (_id: string, opts: CapturedCreate) => {
      h.captured = opts
      return {
        // empty stream → createSdkAgentStream emits its real-usage done from run.wait()
        send: async () => ({
          stream: async function* () {
            /* no events */
          },
          wait: async () => ({}),
        }),
        dispose: async () => {},
      }
    }),
  },
  Tool: { create: (s: unknown) => s },
}))

function baseCompiled(systemPrompt: CompiledAgentOptions['systemPrompt']): CompiledAgentOptions {
  return { systemPrompt, tools: [], agents: {}, stream: true }
}

async function drive(compiled: CompiledAgentOptions): Promise<void> {
  const factory = createSdkAgentStream(compiled, [], 'test-key')
  for await (const _event of factory('hi', 'session-1')) {
    // drain — the emitted events are irrelevant to this Agent.create wiring assertion
  }
}

describe('V4-L.1 resolver flows through createSdkAgentStream to Agent.create', () => {
  // The mock writes `h.captured` on every Agent.create call, so each `drive()`
  // refreshes it — no manual reset (which would sticky-narrow the type to `null`).
  it('test_createSdkAgentStream_passes_resolver_to_agent_create', async () => {
    const resolver: SystemPromptResolver = (ctx) => `prompt for ${ctx.cwd ?? '?'}`
    await drive(baseCompiled(resolver))
    expect(h.captured).not.toBeNull()
    expect(h.captured?.systemPrompt).toBe(resolver) // byref — same function reference
  })

  it('test_createSdkAgentStream_still_passes_string_systemPrompt', async () => {
    await drive(baseCompiled('static prompt'))
    expect(h.captured?.systemPrompt).toBe('static prompt') // byvalue — backward compat
  })
})
