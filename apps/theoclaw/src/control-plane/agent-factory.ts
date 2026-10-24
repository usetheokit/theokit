import { Agent } from '@theokit/sdk'

import type { BindEnvironment } from './bind.js'
import { requireModel } from './settings.js'
import type { TurnAgent } from './turn.js'

/** The options the factory passes to `Agent.create`, every one of them. */
export interface TheoClawAgentOptions {
  readonly model: string
  readonly apiKey: string
  /** The SDK registers `shell` on every local agent; a control-socket turn gets none. */
  readonly withheldBuiltinTools: readonly 'shell'[]
  /** Off, so a finished turn writes no transcript under `.theokit/memory/sessions/` in the cwd. */
  readonly memory: { readonly enabled: false }
}

/** The slice of `Agent.create` the factory calls; tests pass a fake. */
export type CreateAgent = (options: TheoClawAgentOptions) => Promise<TurnAgent>

/**
 * One agent per call, with the model key passed explicitly (plan D4): the SDK refuses
 * `OPENROUTER_API_KEY` from the environment, so the key is resolved here by the same
 * `requireModel` the start checks, and handed to `Agent.create`. The process entry and the live
 * test both build their agents through this function, so the live check proves the entry's own.
 *
 * Whoever holds the control token sends the prompt, and a prompt can be steered, so the agent is
 * built without the SDK's `shell` builtin (no command runs on the host from a chat frame) and with
 * memory off (no transcript of the conversation lands on disk). The SDK still records each agent
 * in `<cwd>/.theokit/agents/registry.json`; no option turns that off.
 */
export function createAgentFactory(
  env: BindEnvironment,
  create: CreateAgent = (options) => Agent.create(options),
): () => Promise<TurnAgent> {
  return async () => {
    const { model, modelKey } = requireModel(env)
    return create({ model, apiKey: modelKey, withheldBuiltinTools: ['shell'], memory: { enabled: false } })
  }
}

/**
 * The agents of chat replies. Anyone who can message the bot writes their prompt (no sender
 * allowlist yet, B-371), so a channel agent must hold no tool and write nothing to disk: built by
 * `createAgentFactory`, it gets no `shell` (`effectiveToolNames` reads an empty catalog) and memory
 * off. It is its own export so the reply path keeps that guarantee, pinned by its own test, even
 * if the `/control` turn's options change.
 */
export function createChannelAgentFactory(
  env: BindEnvironment,
  create?: CreateAgent,
): () => Promise<TurnAgent> {
  return createAgentFactory(env, create)
}
