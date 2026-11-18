/**
 * `hooksForChild` — carry a parent's `HookHandlers` onto a child agent as an SDK `Plugin`.
 *
 * A child (squad member, reviewer, subagent) that does not run the parent's `pre_tool_call` gate
 * escapes the parent's vetoes. The handler receives the SDK's own hook context for the CHILD's call,
 * so its real `agentId` and `runId` reach the parent policy — nothing is replaced by a placeholder.
 *
 * Default forwarding is the veto only (`pre_tool_call`). `post_tool_call` and `transform_tool_result`
 * are opt-in through `forward`, because running a parent's result rewriter on a child's output is a
 * choice the caller makes explicitly.
 */
import type { Plugin } from '@theokit/sdk'

import type { HookHandlers } from '../bridge/hook-handlers.js'

type ForwardedHook = 'pre_tool_call' | 'post_tool_call' | 'transform_tool_result'

export interface HooksForChildOptions {
  /** Which parent handlers reach the child. Default: `['pre_tool_call']` (the veto). */
  forward?: readonly ForwardedHook[]
  /**
   * Optional label added to the context as `childLabel`, so the parent hook can tell a child call
   * apart. The SDK context type does not declare it; a handler reads it by narrowing the context.
   */
  childLabel?: string
}

const DEFAULT_FORWARD: readonly ForwardedHook[] = ['pre_tool_call']

/** Add `childLabel` to a context only when one was requested; the original fields are untouched. */
function labelled<C extends object>(ctx: C, childLabel: string | undefined): C {
  return childLabel === undefined ? ctx : { ...ctx, childLabel }
}

/** Undefined when none of the forwarded handlers exist, so callers can spread it conditionally. */
export function hooksForChild(
  handlers: HookHandlers,
  opts: HooksForChildOptions = {},
): Plugin | undefined {
  const forward = new Set(opts.forward ?? DEFAULT_FORWARD)
  const label = opts.childLabel
  const pre = forward.has('pre_tool_call') ? handlers.pre_tool_call : undefined
  const post = forward.has('post_tool_call') ? handlers.post_tool_call : undefined
  const transform = forward.has('transform_tool_result')
    ? handlers.transform_tool_result
    : undefined
  if (typeof pre !== 'function' && typeof post !== 'function' && typeof transform !== 'function') {
    return undefined
  }
  return {
    name: 'theokit-hooks-for-child',
    version: '1.0.0',
    // `kind: 'general'` is load-bearing: the SDK drops a plugin without it and no hook fires.
    kind: 'general',
    register(ctx) {
      if (typeof pre === 'function') ctx.on('pre_tool_call', (c) => pre(labelled(c, label)))
      if (typeof post === 'function') ctx.on('post_tool_call', (c) => post(labelled(c, label)))
      if (typeof transform === 'function') {
        ctx.on('transform_tool_result', (results, c) => transform(results, labelled(c, label)))
      }
    },
  }
}
