import { Agent } from '@theokit/sdk'
import type { ModelSelection, SDKAgent } from '@theokit/sdk'

import type { AgentToolOptions } from '../tools/tool-registry.js'

export interface CreateTheoClawAgentInput {
  /** The `THEOCLAW_MODEL` string in the process; a `{ id, url }` selection in the stub tests. */
  readonly model: string | ModelSelection
  readonly apiKey: string
  readonly toolOptions: AgentToolOptions
}

/**
 * The one place an agent with tools is built: the model and its key, memory off (no transcript of
 * the conversation lands on disk), and the tool options of `agentToolOptions` (the published tools,
 * the path veto, the builtin `shell` withheld).
 */
export function createTheoClawAgent(input: CreateTheoClawAgentInput): Promise<SDKAgent> {
  return Agent.create({
    model: input.model,
    apiKey: input.apiKey,
    memory: { enabled: false },
    tools: input.toolOptions.tools,
    plugins: input.toolOptions.plugins,
    withheldBuiltinTools: input.toolOptions.withheldBuiltinTools,
  })
}
