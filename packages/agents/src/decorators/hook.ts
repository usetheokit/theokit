/**
 * @Hook() — lifecycle hooks WITHIN the agent loop.
 *
 * Unlike HTTP interceptors (which wrap the entire handler), hooks fire at
 * specific points during the agent's reasoning → tool → response cycle.
 *
 * Hook points:
 * - 'before:llm-call'  — before each LLM API call
 * - 'after:llm-call'   — after each LLM response
 * - 'before:tool-call' — before each tool execution
 * - 'after:tool-call'  — after each tool result
 * - 'on:iteration'     — at each loop iteration
 * - 'on:complete'      — when the agent produces a final answer
 * - 'on:error'         — when the agent encounters an error
 *
 * @example
 * ```ts
 * @Agent({ name: 'support', route: '/support' })
 * class SupportAgent {
 *   @MainLoop()
 *   async run() {}
 *
 *   @Hook('before:llm-call')
 *   async injectContext(ctx: HookContext) {
 *     ctx.appendSystemPrompt(`Time: ${new Date().toISOString()}`)
 *   }
 *
 *   @Hook('after:tool-call')
 *   async trackCost(ctx: HookContext) {
 *     await billing.track(ctx.toolCall!.name, ctx.toolCall!.durationMs)
 *   }
 * }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const HOOKS_CONFIG = Symbol.for('theokit:agents:hooks')

export type HookPoint =
  | 'before:llm-call'
  | 'after:llm-call'
  | 'before:tool-call'
  | 'after:tool-call'
  | 'on:iteration'
  | 'on:complete'
  | 'on:error'

export interface HookEntry {
  point: HookPoint
  propertyKey: string | symbol
}

export function Hook(point: HookPoint): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const actualTarget = target.constructor
    const existing = getMeta<HookEntry[]>(HOOKS_CONFIG, actualTarget) ?? []
    setMeta(HOOKS_CONFIG, actualTarget, [...existing, { point, propertyKey }])
  }
}

export function getHooks(target: Function): HookEntry[] {
  return getMeta<HookEntry[]>(HOOKS_CONFIG, target) ?? []
}

export function getHooksByPoint(target: Function, point: HookPoint): HookEntry[] {
  return getHooks(target).filter((h) => h.point === point)
}
