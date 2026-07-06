/**
 * M7 — `defineAgentTool` forwards the run `ctx` (2nd arg) to the user handler.
 *
 * The SDK runtime calls a tool handler with `(input, { signal, context })`. Before M7 the
 * `defineAgentTool` wrapper was `async (input) => spec.handler(parsed)` — it silently dropped
 * `ctx`, so a tool could never read the `defineAgent({ context })` value (e.g. `projectRoot`).
 * These tests lock the forwarding + backward-compatibility of one-arg handlers.
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { defineAgentTool } from '../../packages/theo/src/server/define/define-agent-tool.js'

describe('defineAgentTool run-context forwarding (M7)', () => {
  it('forwards ctx.context to the handler', async () => {
    let seen: unknown
    const tool = defineAgentTool({
      name: 'read_root',
      description: 'reads project root from the run context',
      inputSchema: z.object({}),
      handler: (_input, ctx) => {
        seen = ctx?.context
        return 'ok'
      },
    })

    await tool.handler({}, { context: { projectRoot: '/repo' } })

    expect(seen).toEqual({ projectRoot: '/repo' })
  })

  it('forwards ctx.signal alongside ctx.context', async () => {
    const controller = new AbortController()
    let seenSignal: AbortSignal | undefined
    const tool = defineAgentTool({
      name: 'with_signal',
      description: 'inspects the abort signal',
      inputSchema: z.object({}),
      handler: (_input, ctx) => {
        seenSignal = ctx?.signal
        return 'ok'
      },
    })

    await tool.handler({}, { signal: controller.signal, context: { a: 1 } })

    expect(seenSignal).toBe(controller.signal)
  })

  it('stays backward-compatible: a one-arg handler still works without ctx', async () => {
    // Negative/edge: the SDK may call the handler with no ctx; a handler that ignores ctx
    // must not throw. Proves the optional 2nd arg does not break the pre-M7 call shape.
    const tool = defineAgentTool({
      name: 'no_ctx',
      description: 'ignores the run context entirely',
      inputSchema: z.object({ name: z.string() }),
      handler: (input) => `hi ${input.name}`,
    })

    await expect(tool.handler({ name: 'ana' })).resolves.toBe('hi ana')
  })
})
