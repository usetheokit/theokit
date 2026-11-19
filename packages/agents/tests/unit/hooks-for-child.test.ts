import { describe, expect, it, vi } from 'vitest'

import { hooksForChild } from '../../src/hooks/index.js'

type Fn = (...args: unknown[]) => unknown

/** Register the plugin against a fake plugin context and capture each hook's handler by name. */
function capture(plugin: unknown) {
  const handlers: Record<string, Fn> = {}
  const p = plugin as { register(ctx: { on(hook: string, fn: Fn): void }): void }
  p.register({ on: (hook, fn) => (handlers[hook] = fn) })
  return handlers
}

const call = { name: 'rm', args: { path: '/' }, agentId: 'child-1', runId: 'run-9' }

describe('hooksForChild', () => {
  it('a parent pre_tool_call veto blocks the child tool call', async () => {
    const veto = { block: true as const, message: 'no rm' }
    const h = capture(hooksForChild({ pre_tool_call: () => veto }))
    expect(await h.pre_tool_call(call)).toEqual(veto)
  })

  it('refuses when the parent gate throws', async () => {
    const h = capture(
      hooksForChild({
        pre_tool_call: () => {
          throw new Error('boom')
        },
      }),
    )
    expect(await h.pre_tool_call(call)).toMatchObject({ block: true })
  })

  it("the parent hook receives the child's agentId and runId", async () => {
    const pre = vi.fn()
    const h = capture(hooksForChild({ pre_tool_call: pre }))
    await h.pre_tool_call(call)
    expect(pre).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'child-1', runId: 'run-9' }),
    )
  })

  it('adds childLabel to the context', async () => {
    const pre = vi.fn()
    const h = capture(hooksForChild({ pre_tool_call: pre }, { childLabel: 'reviewer' }))
    await h.pre_tool_call(call)
    expect(pre).toHaveBeenCalledWith(expect.objectContaining({ childLabel: 'reviewer' }))
  })

  it('forwards only pre_tool_call by default, and the others when asked', async () => {
    const handlers = {
      pre_tool_call: vi.fn(),
      post_tool_call: vi.fn(),
      transform_tool_result: <T>(r: T): T => ('x' + String(r)) as T,
    }
    expect(Object.keys(capture(hooksForChild(handlers)))).toEqual(['pre_tool_call'])
    const all = capture(
      hooksForChild(handlers, {
        forward: ['pre_tool_call', 'post_tool_call', 'transform_tool_result'],
      }),
    )
    await all.post_tool_call(call)
    expect(handlers.post_tool_call).toHaveBeenCalledOnce()
    expect(await all.transform_tool_result('r', call)).toBe('xr')
  })

  it('hooksForChild returns undefined when no forwarded handler exists', () => {
    expect(hooksForChild({})).toBeUndefined()
    expect(hooksForChild({ post_tool_call: () => undefined })).toBeUndefined()
    expect(hooksForChild({ pre_tool_call: () => undefined }, { forward: [] })).toBeUndefined()
  })
})
