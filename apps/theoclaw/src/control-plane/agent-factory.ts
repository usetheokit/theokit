import { Agent } from '@theokit/sdk'

import type { BindEnvironment } from './bind.js'
import { requireModel } from './settings.js'
import type { TurnAgent } from './turn.js'

/** The slice of `Agent.create` the factory calls; tests pass a fake. */
export type CreateAgent = (options: { readonly model: string; readonly apiKey: string }) => Promise<TurnAgent>

/**
 * One agent per call, with the model key passed explicitly (plan D4): the SDK refuses
 * `OPENROUTER_API_KEY` from the environment, so the key is resolved here by the same
 * `requireModel` the start checks, and handed to `Agent.create`. The process entry and the live
 * test both build their agents through this function, so the live check proves the entry's own.
 */
export function createAgentFactory(
  env: BindEnvironment,
  create: CreateAgent = (options) => Agent.create(options),
): () => Promise<TurnAgent> {
  return async () => {
    const { model, modelKey } = requireModel(env)
    return create({ model, apiKey: modelKey })
  }
}
