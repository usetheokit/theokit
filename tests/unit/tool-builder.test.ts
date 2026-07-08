/**
 * M31 Phase 1 — `tool()` fluent builder.
 *
 * The builder is the builder-only replacement for `defineAgentTool({...})`. Its `.build()` MUST
 * emit a `CustomTool` structurally identical to the legacy object-config call, so the SDK/agent
 * compile path is untouched (identity-shape delegation — blueprint §2).
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import { z } from 'zod'

import { tool } from '../../packages/theo/src/server/define/index.js'
import { defineAgentTool } from '../../packages/theo/src/server/define/define-agent-tool.js'

describe('tool() builder — identity-shape delegation', () => {
  it('emits a CustomTool structurally identical to defineAgentTool({...})', async () => {
    const schema = z.object({ path: z.string() })
    const built = tool('read')
      .describe('Read a file')
      .input(schema)
      .execute(async ({ path }) => `read:${path}`)
      .build()
    const legacy = defineAgentTool({
      name: 'read',
      description: 'Read a file',
      inputSchema: schema,
      handler: async ({ path }) => `read:${path}`,
    })

    expect(built.name).toBe(legacy.name)
    expect(built.description).toBe(legacy.description)
    expect(built.inputSchema).toEqual(legacy.inputSchema)
    // Handler behavior is identical.
    expect(await built.handler({ path: 'a.ts' })).toBe('read:a.ts')
    expect(await built.handler({ path: 'a.ts' })).toBe(await legacy.handler({ path: 'a.ts' }))
  })

  it('infers the execute() input type from the Zod schema', () => {
    tool('typed')
      .input(z.object({ n: z.number() }))
      .execute((input) => {
        expectTypeOf(input).toEqualTypeOf<{ n: number }>()
        return 'ok'
      })
      .build()
  })

  it('forwards ctx.context to the handler (M7 run-context)', async () => {
    const built = tool('ctxread')
      .input(z.object({}))
      .execute(
        async (_input, ctx) => `root:${(ctx?.context as { projectRoot?: string })?.projectRoot}`,
      )
      .build()
    expect(await built.handler({}, { context: { projectRoot: '/tmp/p' } })).toBe('root:/tmp/p')
  })

  it('validates input via Zod before the handler (bad input throws)', async () => {
    const built = tool('validated')
      .input(z.object({ n: z.number() }))
      .execute(async ({ n }) => `n:${n}`)
      .build()
    await expect(built.handler({ n: 'not-a-number' as unknown as number })).rejects.toThrow()
  })

  it('supports rich results via toModelOutput()', async () => {
    const built = tool('rich')
      .input(z.object({ x: z.number() }))
      .execute(async ({ x }) => ({ doubled: x * 2 }))
      .toModelOutput((r) => `doubled=${r.doubled}`)
      .build()
    expect(await built.handler({ x: 3 })).toBe('doubled=6')
  })

  it('rejects an invalid tool name (delegates to defineAgentTool guard)', () => {
    expect(() =>
      tool('1bad')
        .input(z.object({}))
        .execute(async () => 'x')
        .build(),
    ).toThrow(/name must match/)
  })
})
