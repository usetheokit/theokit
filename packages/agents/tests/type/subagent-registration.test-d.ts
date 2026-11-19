import { expectTypeOf } from 'vitest'

import type { SubagentAgentDefinition } from '../../src/bridge/define-agent.js'
import type { SubagentDefinition } from '../../src/index.js'

const inherit: SubagentAgentDefinition = { description: 'd', prompt: 'p', model: 'inherit' }
const selected: SubagentAgentDefinition = { description: 'd', prompt: 'p', model: { id: 'x' } }
// @ts-expect-error a number is not a model selection
const bad: SubagentAgentDefinition = { description: 'd', prompt: 'p', model: 42 }

declare const discovered: SubagentDefinition
const picked: SubagentAgentDefinition = {
  description: discovered.description,
  prompt: discovered.prompt,
  ...(discovered.tools !== undefined ? { tools: discovered.tools } : {}),
  ...(discovered.model !== undefined ? { model: discovered.model } : {}),
  ...(discovered.mcpServers !== undefined ? { mcpServers: discovered.mcpServers } : {}),
}

expectTypeOf(inherit.model).toEqualTypeOf<SubagentAgentDefinition['model']>()
expectTypeOf([selected, bad, picked]).not.toBeAny()
