import { describe, expect, it } from 'vitest'

import { hooksForChild } from '../../src/hooks/index.js'

type Handler = (...a: never[]) => unknown

function fakeContext(): {
  on: (h: string, f: Handler) => void
  fire: (h: string, ...a: unknown[]) => unknown
} {
  const map = new Map<string, Handler>()
  return {
    on: (h, f) => void map.set(h, f),
    fire: (h, ...a) => (map.get(h) as (...x: unknown[]) => unknown)?.(...a),
  }
}

function install(plugin: unknown): ReturnType<typeof fakeContext> {
  const ctx = fakeContext()
  ;(plugin as { register(c: unknown): void }).register(ctx)
  return ctx
}

const callCtx = { agentId: 'child-1', runId: 'run-9', name: 'bash', args: { cmd: 'rm' } }

describe('hooksForChild', () => {
  it('a parent pre_tool_call veto blocks the child tool call', async () => {
    const ctx = install(
      hooksForChild({ pre_tool_call: () => ({ block: true, message: 'no' }) } as never),
    )
    expect(await ctx.fire('pre_tool_call', callCtx)).toEqual({ block: true, message: 'no' })
  })

  it("the parent hook receives the child's agentId and runId", async () => {
    const seen: unknown[] = []
    const ctx = install(
      hooksForChild({ pre_tool_call: (c: unknown) => void seen.push(c) } as never),
    )
    await ctx.fire('pre_tool_call', callCtx)
    expect(seen[0]).toMatchObject({ agentId: 'child-1', runId: 'run-9' })
    expect(seen[0]).not.toHaveProperty('childLabel')
  })

  it('adds childLabel when requested', async () => {
    const seen: unknown[] = []
    const ctx = install(
      hooksForChild({ pre_tool_call: (c: unknown) => void seen.push(c) } as never, {
        childLabel: 'reviewer',
      }),
    )
    await ctx.fire('pre_tool_call', callCtx)
    expect(seen[0]).toMatchObject({ agentId: 'child-1', childLabel: 'reviewer' })
  })

  it('forwards only pre_tool_call by default, others on opt-in', async () => {
    const h = { pre_tool_call: () => undefined, post_tool_call: () => undefined } as never
    const registered: string[] = []
    ;(hooksForChild(h) as unknown as { register(c: unknown): void }).register({
      on: (n: string) => registered.push(n),
    })
    expect(registered).toEqual(['pre_tool_call'])
    const opted = install(
      hooksForChild({ transform_tool_result: (r: unknown) => [r] } as never, {
        forward: ['transform_tool_result'],
      }),
    )
    expect(await opted.fire('transform_tool_result', 'x', { agentId: 'a', runId: 'r' })).toEqual([
      'x',
    ])
  })

  it('hooksForChild returns undefined when no forwarded handler exists', () => {
    expect(hooksForChild({})).toBeUndefined()
    expect(hooksForChild({ post_tool_call: () => undefined })).toBeUndefined()
  })
})
