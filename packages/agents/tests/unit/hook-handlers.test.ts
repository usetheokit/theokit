/**
 * M82 T2.1 — `HookHandlers` is public and `.hooks()` accepts it.
 *
 * ## What these tests hold
 *
 * `.hooks()` received `Readonly<Record<string, unknown>>`: any key passed and every handler arrived
 * with `ctx: unknown`. Anyone wanting types declared their own — and agent-builder did, with a local
 * alias of five handlers, four of them carrying `ctx: unknown` because there was no context to
 * import. It is the same class as M81 (`loadRole`): framework knowledge reimplemented in the app.
 *
 * The type test here is a COMPILE-time assertion — if `ctx` goes back to being `unknown`, the
 * accesses to `ctx.name` / `ctx.toolCalls` stop compiling and the package's `tsc` fails. `vitest`
 * transpiles without typechecking, so this file only proves the contract when `tsc` runs alongside
 * (it runs in
 * pre-push e no CI).
 */
import { describe, expect, it } from 'vitest'

import { AgentBuilder } from '../../src/index.js'
import type { HookHandlers } from '../../src/bridge/hook-handlers.js'

describe('M82 — public HookHandlers', () => {
  it('test_HookHandlers_types_the_ctx_of_every_handler', async () => {
    const names: string[] = []
    const handlers: HookHandlers = {
      // `ctx.name` only compiles because the context is `PreToolCallContext`, not `unknown`.
      pre_tool_call: (ctx) => {
        names.push(ctx.name)
        return undefined
      },
      // M82's central gain: the transform seam sees the turn's tool calls.
      transform_tool_result: (results, ctx) => {
        for (const c of ctx.toolCalls) names.push(c.name)
        return results
      },
      post_tool_call: (ctx) => {
        names.push(ctx.result.stdout)
      },
    }

    const def = AgentBuilder.create().model('x').hooks(handlers).build()
    expect(def.hooks).toBe(handlers)

    // The collection exists to be READ: running the handlers proves the typed fields are callable, not
    // merely declarable. Without this part the test would be a compile assertion in disguise.
    await handlers.pre_tool_call?.({ agentId: 'a', runId: 'r', name: 'alpha', args: {} })
    await handlers.transform_tool_result?.([], {
      agentId: 'a',
      runId: 'r',
      toolCalls: [{ id: 'c1', name: 'beta', args: {} }],
    })
    expect(names).toEqual(['alpha', 'beta'])
  })

  it('test_COUNTERPROOF_hooks_still_accepts_the_loose_shape', () => {
    // ADR-4: narrowing in one go would break a consumer with a non-conforming handler. The union keeps
    // the old path alive — without this counterproof, swapping the signature for a plain `HookHandlers`
    // would pass the test above and break whoever passes a loose map today.
    const loose: Readonly<Record<string, unknown>> = { on_session_start: () => undefined }
    const def = AgentBuilder.create().model('x').hooks(loose).build()
    expect(def.hooks).toBe(loose)
  })
})
