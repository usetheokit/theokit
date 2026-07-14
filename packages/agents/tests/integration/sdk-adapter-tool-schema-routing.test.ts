/**
 * M6 dogfood fix — `buildSdkTools` routes tools by inputSchema shape.
 *
 * A `@Tool` compiles to a CompiledTool with a live ZOD `inputSchema` → must go through the SDK's
 * `defineTool` (lowers Zod → JSON Schema + wraps parsing). A `defineAgentTool` result is ALREADY an
 * SDK-ready CustomTool with a JSON-Schema `inputSchema` → must be forwarded RAW; re-running it through
 * `defineTool` (which reads Zod internals like `.def`) crashes at runtime with
 * "Cannot read properties of undefined (reading 'def')" — the exact bug a live `npx create-theokit`
 * tool call surfaced. This test locks the routing so the regression cannot return.
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { z } from 'zod'

const h = vi.hoisted(() => ({ captured: null as { tools?: unknown[] } | null }))

vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  Agent: {
    getOrCreate: vi.fn(async (_id: string, opts: { tools?: unknown[] }) => {
      h.captured = opts
      return {
        send: async () => ({ stream: async function* () {}, wait: async () => ({}) }),
        dispose: async () => {},
      }
    }),
  },
  // defineTool MARKS its result so the test can prove which tools were re-defined vs forwarded raw.
  // It also reads inputSchema like the real SDK would — a JSON-Schema object reaching here would be a bug.
  Tool: { create: (s: { inputSchema: unknown }) => ({ __defined: true, ...s }) },
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
import type { CompiledAgentOptions, CompiledTool } from '../../src/bridge/agent-compiler.js'

async function drain(compiled: CompiledAgentOptions): Promise<void> {
  for await (const _ of createSdkAgentStream(compiled, compiled.tools, 'k')('hi', 's1')) {
    // consume — triggers Agent.getOrCreate with the built tools
  }
}

describe('buildSdkTools routes by inputSchema shape (M6 dogfood fix)', () => {
  beforeEach(() => {
    h.captured = null
  })

  it('test_zod_tool_goes_through_defineTool_and_json_tool_is_forwarded_raw', async () => {
    // A @Tool-style CompiledTool: live Zod inputSchema (has `.parse`).
    const zodTool: CompiledTool = {
      name: 'search',
      description: 'search',
      inputSchema: z.object({ q: z.string() }),
      handler: () => 'ok',
    }
    // A defineAgentTool-style tool: already-converted JSON-Schema inputSchema (no `.parse`).
    const jsonTool = {
      name: 'add',
      description: 'add',
      inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
      handler: () => '3',
    } as unknown as CompiledTool

    const compiled = {
      tools: [zodTool, jsonTool],
      agents: {},
      stream: true,
    } as CompiledAgentOptions

    await drain(compiled)

    const tools = h.captured?.tools ?? []
    // The Zod tool WAS lowered via defineTool (carries the mock marker).
    const search = tools.find((t) => (t as { name?: string }).name === 'search')
    expect((search as { __defined?: boolean }).__defined).toBe(true)
    // The JSON-Schema tool was forwarded RAW (same reference, NOT re-defined) — no crash.
    expect(tools).toContain(jsonTool)
    expect((jsonTool as { __defined?: boolean }).__defined).toBeUndefined()
  })
})
