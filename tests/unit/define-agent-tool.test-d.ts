import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import { defineAgentTool } from '../../packages/theo/src/server/define/define-agent-tool.js'
import type { CustomTool } from '../../packages/theo/src/server/define/define-agent-tool.js'

/**
 * T1.1 — defineAgentTool type tests.
 *
 * Pins the handler input inference via z.infer<T> and the return type
 * (CustomTool — structurally identical to @theokit/sdk's CustomTool).
 */

describe('defineAgentTool (types)', () => {
  it('infers handler input from inputSchema', () => {
    defineAgentTool({
      name: 'check',
      description: 'd',
      inputSchema: z.object({ count: z.number(), tag: z.string() }),
      handler: (input) => {
        expectTypeOf(input).toEqualTypeOf<{ count: number; tag: string }>()
        return 'ok'
      },
    })
  })

  it('handler may return string OR Promise<string>', () => {
    defineAgentTool({
      name: 'sync',
      description: 'd',
      inputSchema: z.object({}),
      handler: () => 'sync',
    })

    defineAgentTool({
      name: 'async',
      description: 'd',
      inputSchema: z.object({}),
      handler: async () => 'async',
    })
  })

  it('accepts a rich (non-string) handler return when toModelOutput maps it (M18)', () => {
    // M18: the handler may return rich data `R`; `toModelOutput` maps it to the model-visible
    // string. Without `toModelOutput`, a non-string return fails fast at RUNTIME (not compile).
    defineAgentTool({
      name: 'richreturn',
      description: 'd',
      inputSchema: z.object({}),
      handler: () => ({ count: 42 }),
      toModelOutput: (r) => `count=${r.count}`,
    })
  })

  it('return type matches CustomTool structurally', () => {
    const tool = defineAgentTool({
      name: 'check_return',
      description: 'd',
      inputSchema: z.object({ x: z.string() }),
      handler: ({ x }) => x,
    })
    expectTypeOf(tool).toExtend<CustomTool>()
  })
})
