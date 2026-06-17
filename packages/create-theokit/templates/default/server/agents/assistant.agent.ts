/**
 * AssistantAgent — AI-powered task management assistant.
 *
 * Uses the SAME guards and pipeline as HTTP controllers.
 * Tools from @Mixin(TaskTools) are available to the LLM.
 */
import 'reflect-metadata'
import { Agent, MainLoop, Mixin, Memory, Budget, Hook } from '@theokit/agents'
import { UseGuards, UseInterceptors } from '@theokit/http'
import { RolesGuard, Roles, Role } from '../guards/auth.guard.js'
import { TimingInterceptor } from '../interceptors/timing.interceptor.js'
import { TaskTools } from '../toolboxes/task.tools.js'

@Agent({
  // Convention: AssistantAgent → name: 'assistant', route: /api/agents/assistant
  model: 'openai/gpt-4o-mini',
  systemPrompt: `You are a helpful task management assistant.
Use the tasks.* tools to list, search, create, and complete tasks.
Be concise and actionable.`,
})
@UseGuards(RolesGuard)
@UseInterceptors(TimingInterceptor)
@Roles([Role.User])
@Memory({ provider: 'built-in', scope: 'per-user' })
@Budget({ maxCostUsd: 1.0, window: 'daily' })
@Mixin(TaskTools)
export class AssistantAgent {
  @MainLoop({ strategy: 'react', maxIterations: 5 })
  async run() {}

  @Hook('before:llm-call')
  async onBeforeLLM() {
    console.log('  🧠 Agent thinking...')
  }

  @Hook('after:tool-call')
  async onToolDone() {
    console.log('  🔧 Tool executed')
  }
}
