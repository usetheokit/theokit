import type { PreToolCallContext } from '@theokit/sdk'

import type { GeneralPlugin } from './general-plugin.js'

/** How many times the same call may start within the window before the next one is stopped. */
const REPEAT_LIMIT = 3
/** The most recent calls the detector remembers. */
const WINDOW = 20

export interface LoopDetectionOptions {
  readonly limit?: number
  readonly window?: number
}

function signature(name: string, args: unknown): string {
  try {
    return `${name}:${JSON.stringify(args ?? null)}`
  } catch {
    return `${name}:unserializable`
  }
}

/**
 * A `pre_tool_call` plugin that stops a run repeating the same tool call (same tool, same arguments):
 * once `limit` identical calls are among the last `window`, the next one is blocked with the reason.
 * State is per plugin instance, so each agent counts its own calls (OC-80, argument churn aside).
 */
export function loopDetectionPlugin(options: LoopDetectionOptions = {}): GeneralPlugin {
  const limit = options.limit ?? REPEAT_LIMIT
  const window = options.window ?? WINDOW
  const recent: string[] = []
  return {
    kind: 'general',
    name: 'theoclaw-loop-detection',
    version: '1.0.0',
    register: (ctx) => {
      ctx.on('pre_tool_call', (context: unknown) => {
        const call = (context ?? {}) as Partial<PreToolCallContext>
        if (call.name === undefined) return undefined
        const key = signature(call.name, call.args)
        const repeats = recent.filter((entry) => entry === key).length
        if (repeats >= limit) {
          return { block: true, message: `theoclaw: loop detected: ${call.name} was called with the same arguments ${repeats} times already; stopping the repeat, try something different` }
        }
        recent.push(key)
        if (recent.length > window) recent.shift()
        return undefined
      })
    },
  }
}
