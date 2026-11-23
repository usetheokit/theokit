/**
 * Why this stays local (#2659, follow-up of #2601). The SDK's window guard (`SendOptions.doomLoop` with
 * `window` + `windowRepeatLimit`, `DoomLoopTracker.checkWindow`) also blocks the Nth identical call inside a
 * sliding window, but it is not equivalent (checked against @theokit/sdk 9.0.0 source):
 * - the SDK window is opt-in per send and both options must be set together; this plugin is a registered plugin
 *   with its own defaults (limit 3, window 20);
 * - the SDK records EVERY attempt, blocked ones too, so a blocked call keeps the signature in the window; here
 *   a blocked call is not recorded;
 * - the SDK signature uses canonical (sorted-key) JSON, so `{a,b}` and `{b,a}` match; here it is plain
 *   `JSON.stringify(args)`, so key order matters;
 * - unserializable input: the SDK shares one `unserializable` key per tool name, as here (`name:unserializable`);
 * - the SDK's separate consecutive guard stops the run (`stoppedByDoomLoop`); this plugin never stops the run.
 * SDK issue: https://github.com/usetheokit/theokit-sdk/issues/1502 (sendDefaults cannot carry doomLoop).
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
