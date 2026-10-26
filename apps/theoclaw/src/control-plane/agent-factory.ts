import { createTheoClawAgent, theoClawAgentOptions } from '../agent/create-agent.js'
import type { TheoClawAgentOptions } from '../agent/create-agent.js'
import type { AgentToolOptions } from '../tools/tool-registry.js'
import type { BindEnvironment } from './bind.js'
import { requireModel } from './settings.js'
import type { TurnAgent } from './turn.js'

export type { TheoClawAgentOptions } from '../agent/create-agent.js'

/** The slice of `Agent.create` the factory calls; tests pass a fake. */
export type CreateAgent = (options: TheoClawAgentOptions) => Promise<TurnAgent>

/**
 * One agent per call, with the model key passed explicitly (plan D4): the SDK refuses
 * `OPENROUTER_API_KEY` from the environment, so the key is resolved here by the same
 * `requireModel` the start checks, and handed to `Agent.create`. The process entry and the live
 * test both build their agents through this function, so the live check proves the entry's own.
 *
 * Whoever holds the control token sends the prompt, and a prompt can be steered, so the agent is
 * built without the SDK's `shell` builtin (no unsandboxed command runs on the host from a chat
 * frame) and with memory off (no transcript of the conversation lands on disk). The tools it does
 * get are the start's `agentToolOptions` (B-382): the published theokit tools bound to the tool
 * root and the sandbox, and the state-directory veto. The SDK still records each agent in
 * `<cwd>/.theokit/agents/registry.json`; no option turns that off.
 */
export function createAgentFactory(
  env: BindEnvironment,
  create: CreateAgent = createTheoClawAgent,
): (toolOptions?: AgentToolOptions) => Promise<TurnAgent> {
  return async (toolOptions) => {
    const { model, modelKey } = requireModel(env)
    return create(theoClawAgentOptions({ model, apiKey: modelKey, ...(toolOptions === undefined ? {} : { toolOptions }) }))
  }
}

/**
 * The agents of chat replies. Whoever reaches the agent writes their prompt (everyone under
 * `THEOCLAW_DM_POLICY=open`, B-371), so a channel agent must hold no tool and write nothing to disk:
 * built by `createAgentFactory` with no tool options, it gets no `shell` (`effectiveToolNames` reads
 * an empty catalog) and memory off. The wrapper takes no argument, so nothing a caller passes can
 * hand it tools. It is its own export so the reply path keeps that guarantee, pinned by its own
 * test, even if the `/control` turn's options change.
 */
export function createChannelAgentFactory(
  env: BindEnvironment,
  create?: CreateAgent,
): () => Promise<TurnAgent> {
  const factory = createAgentFactory(env, create)
  return () => factory()
}
