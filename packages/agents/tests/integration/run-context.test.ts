/**
 * M7 — run-context / dependency injection for tools.
 *
 * BDD: Given `defineAgent({ context })`, When the agent runs a tool, Then the tool's handler
 * receives that object as `ctx.context` — so shared config (e.g. `projectRoot`) is set ONCE at
 * the agent level instead of baked into each tool factory (mirrors ai-sdk `experimental_context`,
 * mastra `RuntimeContext`, openai-agents-js `RunContext`).
 *
 * This exercises the REAL `createSdkAgentStream` wiring end-to-end; only `@theokit/sdk` is mocked.
 * theokit OWNS the run-context concern: it injects it into every tool handler at the adapter layer
 * (`buildSdkTools`), so the context reaches tools EVEN WHEN the SDK passes no ctx at all. The mock's
 * `send` therefore invokes the handler with NO ctx — a green test proves theokit injects it, with
 * zero dependency on the SDK forwarding anything (works against the published SDK).
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'

import type { CustomTool } from '@theokit/sdk'

const h = vi.hoisted(() => ({
  /** The `ctx.context` the tool handler actually received (via theokit's adapter injection). */
  handlerContext: undefined as unknown,
  /** Set true if the handler was invoked at all (guards against false-negative undefined). */
  handlerCalled: false,
}))

// @theokit/sdk mock: getOrCreate captures the built tools; send invokes the first tool's handler
// with NO ctx (the SDK is NOT the one forwarding context here) and yields a FINISHED stream.
vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  FileSystemConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  defineTool: (spec: unknown) => spec,
  Agent: {
    getOrCreate: vi.fn(
      async (_id: string, opts: { tools?: Array<{ handler: (i: unknown) => unknown }> }) => {
        const tools = opts.tools ?? []
        return {
          send: async () => {
            if (tools[0]) await tools[0].handler({})
            return {
              stream: async function* () {
                yield { type: 'status', status: 'FINISHED' }
              },
              wait: async () => ({}),
            }
          },
          dispose: async () => {},
        }
      },
    ),
  },
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { defineAgent, compileAgentDefinition } = await import('../../src/bridge/define-agent.js')

/** A tool that records the `ctx.context` it is called with — the assertion target. */
function recordingTool(): CustomTool {
  return {
    name: 'read_root',
    description: 'records the run-context it receives',
    inputSchema: {},
    // Annotate the ctx to include `context`: a raw CustomTool's handler ctx is `{ signal? }` in the
    // published SDK; theokit injects `context` at runtime, so a context-reading tool widens the ctx
    // (assignable to CustomTool.handler by contravariance). Real apps use defineAgentTool /
    // contextualTool, which type this for you.
    handler: (_input, ctx?: { signal?: AbortSignal; context?: unknown }) => {
      h.handlerCalled = true
      h.handlerContext = ctx?.context
      return 'ok'
    },
  }
}

/** Drain a stream to completion (we assert on captured side effects, not the events). */
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream) {
    // consume
  }
}

describe('M7 run-context reaches tool handlers (injected by theokit adapter)', () => {
  beforeEach(() => {
    h.handlerContext = undefined
    h.handlerCalled = false
  })

  it('test_defineAgent_context_reaches_tool_handler_ctx', async () => {
    const def = defineAgent({ context: { projectRoot: '/repo' }, tools: [recordingTool()] })
    const compiled = compileAgentDefinition(def)

    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-1'))

    expect(h.handlerCalled).toBe(true)
    // The agent-level context reached the tool handler's ctx.context — even though the SDK mock
    // passed no ctx (theokit injected it at the adapter layer).
    expect(h.handlerContext).toEqual({ projectRoot: '/repo' })
  })

  it('test_per_run_context_override_wins_over_agent_level', async () => {
    const def = defineAgent({ context: { projectRoot: '/agent' }, tools: [recordingTool()] })
    const compiled = compileAgentDefinition(def)

    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key', {
      runContext: { projectRoot: '/override' },
    })
    await drain(factory('go', 'sess-2'))

    expect(h.handlerContext).toEqual({ projectRoot: '/override' })
  })

  it('test_no_context_leaves_handler_ctx_context_undefined', async () => {
    // Regression guard: absent context ⇒ handlers are passed through unwrapped (byte-identical to
    // pre-M7) and ctx.context is undefined.
    const def = defineAgent({ tools: [recordingTool()] })
    const compiled = compileAgentDefinition(def)

    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-3'))

    expect(h.handlerCalled).toBe(true)
    expect(h.handlerContext).toBeUndefined()
  })

  it('test_empty_context_object_is_forwarded_as_empty_object', async () => {
    // Edge case: an explicitly empty {} is a valid context (distinct from "no context").
    const def = defineAgent({ context: {}, tools: [recordingTool()] })
    const compiled = compileAgentDefinition(def)

    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-4'))

    expect(h.handlerCalled).toBe(true)
    expect(h.handlerContext).toEqual({})
  })

  it('test_per_run_context_completely_replaces_agent_level_not_merges', async () => {
    // Edge case: per-run override replaces agent-level entirely — no merging of keys.
    // Agent-level has 'base'; per-run has only 'override'. Handler must NOT see 'base'.
    const def = defineAgent({ context: { base: true }, tools: [recordingTool()] })
    const compiled = compileAgentDefinition(def)

    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key', {
      runContext: { override: true },
    })
    await drain(factory('go', 'sess-5'))

    expect(h.handlerContext).toEqual({ override: true })
    expect((h.handlerContext as Record<string, unknown>).base).toBeUndefined()
  })
})
