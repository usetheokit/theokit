import { join } from 'node:path'

import { createTheoClawAgent, theoClawAgentOptions } from '../agent/create-agent.js'
import type { TheoClawAgentOptions } from '../agent/create-agent.js'
import type { AgentToolOptions } from '../tools/tool-registry.js'
import type { BindEnvironment } from './bind.js'
import { requireModel } from './settings.js'
import type { TurnAgent } from './turn.js'

/** The slice of `Agent.create` the factory calls; tests pass a fake. */
export type CreateAgent = (options: TheoClawAgentOptions) => Promise<TurnAgent>

/** A chat session's options: the protected set, plus where its transcripts live. */
export interface SessionAgentOptions extends TheoClawAgentOptions {
  readonly local: { readonly cwd: string; readonly sessionDir: string }
}

/**
 * The options every TheoClaw agent is built with, the model key passed explicitly (plan D4): the
 * SDK refuses `OPENROUTER_API_KEY` from the environment, so the key is resolved here by the same
 * `requireModel` the start checks.
 *
 * Whoever holds the control token, and every sender who reaches a chat agent (everyone under
 * `THEOCLAW_DM_POLICY=open`, B-371), writes the prompt, and a prompt can be steered, so the agent
 * is built without the SDK's `shell` builtin (no unsandboxed command runs on the host from a chat)
 * and with memory off (no memory transcript of the conversation lands under the cwd). These options
 * carry no tool: only a `/control` turn's agent gets the start's `agentToolOptions` (B-382),
 * through `createAgentFactory`. The SDK still records each agent in
 * `<cwd>/.theokit/agents/registry.json`; no option turns that off.
 */
export function agentOptionsFor(env: BindEnvironment): TheoClawAgentOptions {
  const { model, modelKey } = requireModel(env)
  return theoClawAgentOptions({ model, apiKey: modelKey })
}

/**
 * A chat session's agent: the same protected options as a `/control` turn's, so the reply path
 * keeps the key, the withheld `shell` and memory off, plus its transcripts under
 * `<workspace>/.theoclaw` (plan D6), which is what lets a conversation survive a restart.
 */
export function sessionAgentOptions(env: BindEnvironment, workspace: string): SessionAgentOptions {
  return { ...agentOptionsFor(env), local: { cwd: workspace, sessionDir: join(workspace, '.theoclaw') } }
}

/**
 * One agent per call, for the `/control` socket's turns (one request boundary each), with the
 * start's `agentToolOptions` (B-382): the published theokit tools bound to the tool root and the
 * sandbox, and the state-directory veto. The process entry and the live test both build their
 * agents through this function, so the live check proves the entry's own.
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
 * The agent of a chat reply. Whoever reaches the agent writes their prompt (everyone under
 * `THEOCLAW_DM_POLICY=open`, B-371), so a channel agent holds no tool and writes no memory: it is built from
 * `agentOptionsFor`, with no `shell` (`effectiveToolNames` reads an empty catalog) and memory off.
 * It is its own export, and every session agent is opened through it (`composition.ts`), so the
 * reply path keeps the withheld `shell` and memory off, pinned by its own test, even if the
 * `/control` turn's options change (sprint decision B-377 option A).
 */
export function createChannelAgentFactory<A>(
  env: BindEnvironment,
  create: (options: TheoClawAgentOptions) => Promise<A>,
): () => Promise<A> {
  return async () => create(agentOptionsFor(env))
}
