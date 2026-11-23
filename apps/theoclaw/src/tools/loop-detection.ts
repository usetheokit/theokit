/**
 * Why this stays local (#2659, follow-up of #2601). The SDK's doom-loop guard (`SendOptions.doomLoop`,
 * `DoomLoopThresholds.window` + `windowRepeatLimit`) also counts identical calls inside a sliding window,
 * but it is not equivalent to this plugin:
 * - the SDK window is opt-in per send (consecutive-only by default); this plugin is always on once registered;
 * - the SDK stops the run (`stoppedByDoomLoop`, `terminal: "no_progress"`); this plugin only blocks the one
 *   call with a message and lets the model try something else;
 * - blocked calls here are NOT recorded in the window, and the window and limit are per plugin instance;
 * - the signature here is `JSON.stringify(args)` (key order matters, unserializable args share one key).
 * SDK issue: NOT FILED YET. No GitHub access was available in the run that wrote this; file it in
 * usetheokit/theokit-sdk from the list above and replace this line with the issue link.
 */
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
