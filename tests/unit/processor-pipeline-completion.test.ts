import { describe, expect, it, vi } from 'vitest'

import {
  createApiErrorHandler,
  runWithApiErrorHandling,
} from '../../packages/agents/src/bridge/api-error-handler.js'
import {
  createToolHooksPlugin,
  type ToolHookRawContext,
} from '../../packages/agents/src/bridge/tool-hooks-plugin.js'

/**
 * M19 — Processor pipeline completion.
 *
 * Two remaining lifecycle seams over the SDK reality (v2.19.0):
 *  - `processInput` — wired to the SDK `pre_user_send` hook. The SDK does NOT let a plugin mutate
 *    the raw prompt/stream; it lets a handler INJECT derived context (`recalledContext`) before the
 *    model. So `processInput` returns a string to prepend as context (honest ceiling; documented).
 *  - `processApiError` — the SDK owns its own retry/backoff, and exposes NO api-error hook to
 *    plugins. Per the M19 top-risk note ("app-level fallback, not a second retry loop"), this is a
 *    SIBLING FACTORY that wraps a run at the app boundary and re-invokes on error. It re-invokes the
 *    SDK — never reimplements the LLM call (G2 / sdk-runtime.md).
 */

/** A tiny fake plugin ctx that records `on(hook, handler)` registrations and can fire them. */
function fakePluginCtx() {
  const handlers = new Map<string, (ctx: ToolHookRawContext) => unknown>()
  return {
    on(hook: string, handler: (ctx: ToolHookRawContext) => unknown) {
      handlers.set(hook, handler)
    },
    fire(hook: string, ctx: ToolHookRawContext) {
      return handlers.get(hook)?.(ctx)
    },
    has: (hook: string) => handlers.has(hook),
  }
}

describe('M19 — processInput (pre_user_send)', () => {
  it('registers a pre_user_send handler only when processInput is provided', () => {
    const withOut = fakePluginCtx()
    createToolHooksPlugin({}).register(withOut)
    expect(withOut.has('pre_user_send')).toBe(false)

    const withIn = fakePluginCtx()
    createToolHooksPlugin({ processInput: () => 'ctx' }).register(withIn)
    expect(withIn.has('pre_user_send')).toBe(true)
  })

  it('maps the returned string to the SDK recalledContext shape', async () => {
    const ctx = fakePluginCtx()
    const seen: string[] = []
    createToolHooksPlugin({
      processInput: ({ prompt }) => {
        seen.push(prompt)
        return `derived-for:${prompt}`
      },
    }).register(ctx)

    const result = (await ctx.fire('pre_user_send', {
      agentId: 'a',
      runId: 'r',
      // pre_user_send carries `prompt`; ToolHookRawContext is a superset.
      prompt: 'hello',
    } as ToolHookRawContext)) as { recalledContext?: string } | undefined

    expect(seen).toEqual(['hello'])
    expect(result).toEqual({ recalledContext: 'derived-for:hello' })
  })

  it('returns undefined (no injection) when processInput yields nothing', async () => {
    const ctx = fakePluginCtx()
    createToolHooksPlugin({ processInput: () => undefined }).register(ctx)
    const result = await ctx.fire('pre_user_send', {
      agentId: 'a',
      runId: 'r',
      prompt: 'x',
    } as ToolHookRawContext)
    expect(result).toBeUndefined()
  })

  it('composes with the M10 tool hooks (both registered)', () => {
    const ctx = fakePluginCtx()
    createToolHooksPlugin({
      processInput: () => 'c',
      beforeToolCall: () => undefined,
    }).register(ctx)
    expect(ctx.has('pre_user_send')).toBe(true)
    expect(ctx.has('pre_tool_call')).toBe(true)
  })
})

describe('M19 — processApiError (sibling factory)', () => {
  it('retries when the handler returns { retry: true }, up to the attempt the handler stops', async () => {
    let attempts = 0
    const run = vi.fn(async () => {
      attempts += 1
      if (attempts < 3) throw new Error('429 rate limit')
      return 'ok'
    })

    const seen: Array<{ attempt: number; message: string }> = []
    const result = await runWithApiErrorHandling(run, {
      processApiError: ({ error, attempt }) => {
        seen.push({ attempt, message: (error as Error).message })
        return { retry: attempt < 3 }
      },
    })

    expect(result).toBe('ok')
    expect(attempts).toBe(3)
    // Two errors observed (attempt 1 and 2); attempt 3 succeeded.
    expect(seen).toEqual([
      { attempt: 1, message: '429 rate limit' },
      { attempt: 2, message: '429 rate limit' },
    ])
  })

  it('rethrows when the handler declines to retry', async () => {
    const run = vi.fn(async () => {
      throw new Error('500 server error')
    })
    await expect(
      runWithApiErrorHandling(run, { processApiError: () => ({ retry: false }) }),
    ).rejects.toThrow('500 server error')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('supports a fallback value instead of a retry', async () => {
    const run = vi.fn(async () => {
      throw new Error('503')
    })
    const result = await runWithApiErrorHandling(run, {
      processApiError: () => ({ retry: false, fallback: 'degraded' }),
    })
    expect(result).toBe('degraded')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('has a hard cap on attempts to prevent an infinite retry loop', async () => {
    const run = vi.fn(async () => {
      throw new Error('always 429')
    })
    await expect(
      runWithApiErrorHandling(run, { processApiError: () => ({ retry: true }), maxAttempts: 4 }),
    ).rejects.toThrow('always 429')
    expect(run).toHaveBeenCalledTimes(4)
  })

  it('createApiErrorHandler returns a reusable wrapper bound to a policy', async () => {
    const guard = createApiErrorHandler({
      processApiError: () => ({ retry: false, fallback: 'fb' }),
    })
    const result = await guard(async () => {
      throw new Error('boom')
    })
    expect(result).toBe('fb')
  })

  it('is a pure pass-through when the run succeeds first try', async () => {
    const handler = vi.fn(() => ({ retry: true }))
    const result = await runWithApiErrorHandling(async () => 'first-try', {
      processApiError: handler,
    })
    expect(result).toBe('first-try')
    expect(handler).not.toHaveBeenCalled()
  })
})
