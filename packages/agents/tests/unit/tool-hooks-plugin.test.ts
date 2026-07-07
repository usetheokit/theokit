/**
 * M10 (theokit-ai-first) — createToolHooksPlugin: beforeToolCall / afterToolCall observability.
 *
 * ADR-0040 § D2: a HOME/BOUNDARY plugin over the SDK's OWN `pre_tool_call` / `post_tool_call`
 * hooks (mirrors `createHitlPlugin`). No LLM, no loop reimplementation — the SDK owns the run.
 * `beforeToolCall` may VETO (return `{ block, message }`); `afterToolCall` observes the result.
 *
 * TDD RED-first. Captures the registered handlers against a fake PluginContext.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  createToolHooksPlugin,
  type ToolHookRawContext,
  type ToolHooksPlugin,
} from '../../src/bridge/tool-hooks-plugin.js'

type Handler = (ctx: ToolHookRawContext) => unknown

/** Register the plugin against a fake PluginContext and capture each hook's handler by name. */
function capture(plugin: ToolHooksPlugin) {
  const handlers: Record<string, Handler> = {}
  plugin.register({ on: (hook, fn) => (handlers[hook] = fn) })
  return handlers
}

describe('createToolHooksPlugin', () => {
  it('fires beforeToolCall with the tool name + args (observation, allow)', async () => {
    const beforeToolCall = vi.fn()
    const h = capture(createToolHooksPlugin({ beforeToolCall }))
    const veto = await h.pre_tool_call({
      name: 'deploy',
      args: { env: 'prod' },
      agentId: 'a',
      runId: 'r',
    })

    expect(beforeToolCall).toHaveBeenCalledWith({ name: 'deploy', args: { env: 'prod' } })
    expect(veto).toBeUndefined() // no veto returned → allow
  })

  it('lets beforeToolCall VETO a tool call', async () => {
    const beforeToolCall = vi.fn(() => ({ block: true as const, message: 'not allowed' }))
    const h = capture(createToolHooksPlugin({ beforeToolCall }))
    const veto = await h.pre_tool_call({ name: 'rm', args: {}, agentId: 'a', runId: 'r' })

    expect(veto).toEqual({ block: true, message: 'not allowed' })
  })

  it('fires afterToolCall with the tool name + result', async () => {
    const afterToolCall = vi.fn()
    const h = capture(createToolHooksPlugin({ afterToolCall }))
    await h.post_tool_call({ name: 'search', result: 'found 3 docs', agentId: 'a', runId: 'r' })

    expect(afterToolCall).toHaveBeenCalledWith({ name: 'search', result: 'found 3 docs' })
  })

  it('registers only the hooks that are provided', () => {
    const h = capture(createToolHooksPlugin({ beforeToolCall: () => undefined }))
    expect(typeof h.pre_tool_call).toBe('function')
    expect(h.post_tool_call).toBeUndefined()
  })

  it('is inert (registers nothing) when no hooks are given', () => {
    const h = capture(createToolHooksPlugin({}))
    expect(Object.keys(h)).toHaveLength(0)
  })

  it('fires beforeLLMCall / afterLLMCall with the LLM turn context (M10)', async () => {
    const beforeLLMCall = vi.fn()
    const afterLLMCall = vi.fn()
    const h = capture(createToolHooksPlugin({ beforeLLMCall, afterLLMCall }))

    await h.pre_llm_call({ agentId: 'a', runId: 'r', iteration: 0 })
    await h.post_llm_call({ agentId: 'a', runId: 'r', iteration: 0 })

    expect(beforeLLMCall).toHaveBeenCalledWith({ agentId: 'a', runId: 'r', iteration: 0 })
    expect(afterLLMCall).toHaveBeenCalledWith({ agentId: 'a', runId: 'r', iteration: 0 })
  })

  it('registers only the LLM hooks that are provided', () => {
    const h = capture(createToolHooksPlugin({ beforeLLMCall: () => {} }))
    expect(typeof h.pre_llm_call).toBe('function')
    expect(h.post_llm_call).toBeUndefined()
    expect(h.pre_tool_call).toBeUndefined()
  })
})

/**
 * Regression (M19) — the SDK's `isCodePlugin()` gate drops any plugin object lacking
 * `kind: 'general'`, so a `register()`-only object NEVER fires its hooks. Proven via a real
 * OpenRouter run. This guard fails loud if the discriminator regresses.
 */
describe('createToolHooksPlugin — SDK code-plugin discriminator', () => {
  it("declares kind: 'general' and a version so isCodePlugin() accepts it", () => {
    const plugin: ToolHooksPlugin = createToolHooksPlugin({ afterToolCall: () => {} })
    expect(plugin.kind).toBe('general')
    expect(typeof plugin.version).toBe('string')
    expect(plugin.version.length).toBeGreaterThan(0)
    expect(typeof plugin.register).toBe('function')
  })
})
