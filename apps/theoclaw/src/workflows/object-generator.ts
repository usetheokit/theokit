import { Agent } from '@theokit/sdk'

import { requireModel } from '../control-plane/settings.js'
import type { BindEnvironment } from '../control-plane/bind.js'
import type { GenerateObject } from './triage-workflow.js'

/**
 * The `GenerateObject` seam over the SDK's `Agent.generateObject` (B-678): the model key passed
 * explicitly as every TheoClaw agent, `shell` withheld and memory off, so the step can only produce JSON.
 */
export function createObjectGenerator(env: BindEnvironment, cwd?: string): GenerateObject {
  return async (prompt, schema) => {
    const { model, modelKey } = requireModel(env)
    const result = await Agent.generateObject({
      schema,
      prompt,
      model,
      apiKey: modelKey,
      withheldBuiltinTools: ['shell'],
      memory: { enabled: false },
      local: cwd === undefined ? {} : { cwd },
    })
    return result.object
  }
}
