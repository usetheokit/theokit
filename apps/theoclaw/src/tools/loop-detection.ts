import type { Plugin, PreToolCallContext } from '@theokit/sdk'

/** Identical calls in a row that a run may make before the next one is refused. */
export const DEFAULT_LOOP_LIMIT = 3

export interface LoopDetectionOptions {
  /** How many identical consecutive calls are let through; the next is blocked. Default 3. */
  readonly limit?: number
}

function key(name: string, args: unknown): string {
  try {
    return `${name}\u0000${JSON.stringify(args ?? null)}`
  } catch {
    return `${name}\u0000unserializable`
  }
}

/**
 * A `pre_tool_call` plugin that refuses a tool call identical (same tool, same arguments) to the
 * `limit` calls just before it, saying why. One plugin instance holds one run's history, so build
 * one per agent; any different call resets the streak.
 */
export function loopDetectionPlugin(options: LoopDetectionOptions = {}): Plugin {
  const limit = Math.max(1, options.limit ?? DEFAULT_LOOP_LIMIT)
  let last: string | undefined
  let streak = 0
  return {
    kind: 'general',
    name: 'theoclaw-loop-detection',
    version: '1.0.0',
    register: (ctx) => {
      ctx.on('pre_tool_call', (context: unknown) => {
        const call = (context ?? {}) as Partial<PreToolCallContext>
        if (call.name === undefined) return undefined
        const current = key(call.name, call.args)
        streak = current === last ? streak + 1 : 1
        last = current
        if (streak <= limit) return undefined
        return {
          block: true,
          message: `theoclaw: loop detected: ${call.name} was called ${streak} times in a row with the same arguments; change the approach or stop`,
        }
      })
    },
  }
}
