/**
 * @HumanInTheLoop() — pause agent execution to request human approval.
 *
 * When applied to a @Tool method, the agent pauses before executing the tool
 * and emits an 'approval_required' SSE event. The client must POST to the
 * callback URL to approve or deny. If denied or timed out, the tool is skipped.
 *
 * @example
 * ```ts
 * @Toolbox({ namespace: 'ops' })
 * class OpsTools {
 *   @Tool({ name: 'deploy', description: 'Deploy to prod', input: z.object({...}) })
 *   @HumanInTheLoop({
 *     question: 'Confirm deployment to production?',
 *     timeout: 300_000,
 *     onTimeout: 'abort',
 *   })
 *   async deploy(input: {...}) { ... }
 * }
 * ```
 *
 * SSE event emitted:
 * ```json
 * { "type": "approval_required", "toolName": "ops.deploy", "question": "...", "callbackUrl": "/agents/x/approve/call-123" }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'
import type { HumanInTheLoopOptions } from '../types.js'

const HITL_CONFIG = Symbol.for('theokit:agents:human-in-the-loop')

export type { TimeoutAction } from '../types.js'

export type { HumanInTheLoopOptions } from '../types.js'

export function HumanInTheLoop(options: HumanInTheLoopOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const actualTarget = target.constructor
    setMeta(
      HITL_CONFIG,
      actualTarget,
      {
        timeout: 300_000,
        onTimeout: 'abort',
        showInput: true,
        ...options,
      },
      propertyKey,
    )
  }
}

export function getHumanInTheLoopConfig(
  target: Function,
  propertyKey: string | symbol,
): HumanInTheLoopOptions | undefined {
  return getMeta<HumanInTheLoopOptions>(HITL_CONFIG, target, propertyKey)
}
