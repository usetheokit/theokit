import { Agent } from '@theokit/sdk'
import type { CustomTool, ModelSelection, Plugin, SDKAgent } from '@theokit/sdk'

import type { AgentToolOptions } from '../tools/tool-registry.js'

/** The options every TheoClaw agent is created with, every one of them. */
export interface TheoClawAgentOptions<Model extends string | ModelSelection = string> {
  /** The `THEOCLAW_MODEL` string in the process; a `{ id, url }` selection in the stub tests. */
  readonly model: Model
  readonly apiKey: string
  /** The SDK registers an unsandboxed `shell` on every local agent; no TheoClaw agent gets it. */
  readonly withheldBuiltinTools: readonly 'shell'[]
  /** Off, so a finished turn writes no transcript under `.theokit/memory/sessions/` in the cwd. */
  readonly memory: { readonly enabled: false }
  readonly tools?: CustomTool[]
  readonly plugins?: Plugin[]
}

export interface TheoClawAgentInput<Model extends string | ModelSelection> {
  readonly model: Model
  readonly apiKey: string
  /** The published tools and the path veto (`agentToolOptions`); absent for an agent with no tool. */
  readonly toolOptions?: AgentToolOptions
}

/**
 * The one place an agent's options are assembled: memory off and the builtin `shell` withheld,
 * always, plus the tool options when the agent has tools.
 */
export function theoClawAgentOptions<Model extends string | ModelSelection>(
  input: TheoClawAgentInput<Model>,
): TheoClawAgentOptions<Model> {
  const base = {
    model: input.model,
    apiKey: input.apiKey,
    withheldBuiltinTools: ['shell'] as const,
    memory: { enabled: false } as const,
  }
  if (input.toolOptions === undefined) return base
  // Copied: the SDK takes mutable arrays, and each agent gets its own.
  return { ...base, tools: [...input.toolOptions.tools], plugins: [...input.toolOptions.plugins] }
}

/** Create the agent those options describe, through the SDK. */
export function createTheoClawAgent<Model extends string | ModelSelection>(
  options: TheoClawAgentOptions<Model>,
): Promise<SDKAgent> {
  return Agent.create({
    model: options.model,
    apiKey: options.apiKey,
    withheldBuiltinTools: [...options.withheldBuiltinTools],
    memory: options.memory,
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    ...(options.plugins === undefined ? {} : { plugins: options.plugins }),
  })
}
