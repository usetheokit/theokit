/**
 * `hooksForChild` — carry a parent's hook handlers onto a child agent.
 *
 * An app that delegates (squad members, a reviewer, subagents built with `Agent.create`) must run
 * the parent's `pre_tool_call` policy on the child's tool calls too, or the child escapes the
 * parent's vetoes. This turns the parent's `HookHandlers` into an SDK `Plugin` that
 * `Agent.create({ plugins: [...] })` accepts without a cast.
 *
 * The parent handler receives the SDK's OWN hook context, so the child's real `agentId` and `runId`
 * reach it (a hook that logs or keys decisions per run sees the real run, not a placeholder). When
 * `childLabel` is set it is added to that context as an extra `childLabel` property.
 *
 * Only `pre_tool_call` (the veto) is forwarded by default. `post_tool_call` and
 * `transform_tool_result` are opt-in through `forward`: they observe or rewrite results, which a
 * parent may not want applied to a child's output.
 *
 * Fail closed: a `pre_tool_call` that throws refuses the child's call, as `inheritHooks` does.
 */
import type {
  Plugin,
  PostToolCallContext,
  PreToolCallContext,
  ToolResultTransformContext,
} from '@theokit/sdk'

import type { HookHandlers } from '../bridge/hook-handlers.js'

type ForwardedHook = 'pre_tool_call' | 'post_tool_call' | 'transform_tool_result'

export interface HooksForChildOptions {
  /** Which parent handlers reach the child. Default: `['pre_tool_call']` (the veto). */
  forward?: readonly ForwardedHook[]
  /** Optional label added to the context (as `childLabel`) so the parent hook can tell a child call apart. */
  childLabel?: string
}

const DEFAULT_FORWARD: readonly ForwardedHook[] = ['pre_tool_call']

/** Undefined when none of the forwarded handlers exist, so callers can spread it conditionally. */
export function hooksForChild(
  handlers: HookHandlers,
  opts: HooksForChildOptions = {},
): Plugin | undefined {
  const forward = new Set(opts.forward ?? DEFAULT_FORWARD)
  const { childLabel } = opts
  const label = childLabel === undefined ? {} : { childLabel }

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
    kind: 'general',
    register(ctx) {
      if (typeof pre === 'function') {
        ctx.on('pre_tool_call', async (raw: unknown) => {
          const c = raw as PreToolCallContext
          try {
            return await pre({ ...c, ...label })
          } catch (cause) {
            // Fail CLOSED: a gate that cannot be consulted must not open.
            const reason = cause instanceof Error ? cause.message : String(cause)
            return {
              block: true as const,
              message: `hook gate failed and refused the call: ${reason}`,
            }
          }
        })
      }
      if (typeof post === 'function') {
        ctx.on('post_tool_call', async (raw: unknown) => {
          const c = raw as PostToolCallContext
          await post({ ...c, ...label })
        })
      }
      if (typeof transform === 'function') {
        ctx.on('transform_tool_result', (results: unknown, raw: unknown) =>
          transform(results, { ...(raw as ToolResultTransformContext), ...label }),
        )
      }
    },
  }
}
