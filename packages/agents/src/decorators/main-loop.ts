/**
 * @MainLoop() — marks the execution entry point of an agent.
 *
 * Only one @MainLoop per agent class. Second application overwrites (last-wins, with warning).
 */
import { setMeta, getMeta, AGENT_MAIN_LOOP } from '../metadata/index.js'
import type { MainLoopOptions, MainLoopMeta } from '../types.js'

export function MainLoop(options: MainLoopOptions = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const actualTarget = target.constructor
    const existing = getMeta<MainLoopMeta>(AGENT_MAIN_LOOP, actualTarget)
    if (existing) {
      console.warn(
        `[@theokit/agents] ${actualTarget.name}: @MainLoop() already declared on '${String(existing.propertyKey)}'. Overwriting with '${String(propertyKey)}'.`,
      )
    }
    const meta: MainLoopMeta = {
      propertyKey,
      strategy: options.strategy ?? 'simple-chat',
      maxIterations: options.maxIterations,
      timeoutMs: options.timeoutMs,
    }
    setMeta(AGENT_MAIN_LOOP, actualTarget, meta)
  }
}

export function getMainLoop(target: Function): MainLoopMeta | undefined {
  return getMeta<MainLoopMeta>(AGENT_MAIN_LOOP, target)
}
