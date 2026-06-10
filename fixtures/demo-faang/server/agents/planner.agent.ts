import 'reflect-metadata'
import {
  Agent, MainLoop, Mixin,
  Memory, Budget, Checkpoint,
  Hook, type HookPoint,
} from '../../../../packages/agents/src/decorators/index.js'
import { UseGuards, UseInterceptors, Throttle } from '../../../../packages/http-decorators/src/index.js'
import { RolesGuard, Roles, Role } from '../guards/roles.guard.js'
import { TimingInterceptor } from '../interceptors/timing.interceptor.js'
import { ProjectTools } from '../toolboxes/project.tools.js'

/**
 * PlannerAgent — AI-powered project planning assistant.
 *
 * DEMONSTRATES:
 * - @Agent() as macro over @Controller (same route pattern)
 * - @UseGuards(RolesGuard) — SAME guard as HTTP controllers
 * - @UseInterceptors(TimingInterceptor) — SAME interceptor
 * - @Throttle — rate limiting on agent
 * - @Memory — persistent context
 * - @Budget — cost control
 * - @Checkpoint — resumable execution
 * - @Mixin(ProjectTools) — compose toolbox capabilities
 * - @Hook — lifecycle events
 * - @MainLoop — execution strategy
 */
@Agent({
  name: 'planner',
  route: '/api/agents/planner',
  model: 'claude-sonnet-4-5-20250929',
  systemPrompt: `You are a project planning assistant for TheoKit.
You help teams organize tasks, prioritize work, and track progress.
Use the project.* tools to interact with project data.
Be concise and actionable in your responses.`,
  stream: true,
  maxIterations: 8,
  timeoutMs: 60_000,
})
@UseGuards(RolesGuard)
@UseInterceptors(TimingInterceptor)
@Roles([Role.User])
@Throttle({ limit: 20, ttl: 60_000 })
@Memory({ provider: 'built-in', scope: 'per-user' })
@Budget({ maxCostUsd: 1.00, window: 'daily' })
@Checkpoint({ strategy: 'after-tool-call', storage: 'memory' })
@Mixin(ProjectTools)
export class PlannerAgent {
  @MainLoop({ strategy: 'react', maxIterations: 8 })
  async run() {
    // The SDK handles the actual execution loop.
    // This method is the declaration point — the compiler
    // reads the metadata and wires Agent.create().
  }

  @Hook('before:llm-call')
  async injectContext() {
    console.log('  🧠 [hook] Preparing LLM call...')
  }

  @Hook('after:tool-call')
  async trackToolUsage() {
    console.log('  🔧 [hook] Tool call completed')
  }

  @Hook('on:complete')
  async onComplete() {
    console.log('  ✅ [hook] Agent run complete')
  }
}
