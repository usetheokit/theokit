import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverSubagents } from '@theokit/sdk/subagents-loader'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  compileAgentDefinition,
  defineAgent,
  type SubagentAgentDefinition,
} from '../../src/bridge/define-agent.js'
import { assembleM8CreateOptions } from '../../src/bridge/sdk-adapter-create-options.js'

const agentsOf = (subagents: Record<string, SubagentAgentDefinition>) =>
  (assembleM8CreateOptions(compileAgentDefinition(defineAgent({ model: 'openai/gpt-5.4', subagents })))
    .options as unknown as { agents: Record<string, Record<string, unknown>> }).agents

describe('registering a subagent keeps what its definition declares', () => {
  it('a registered subagent keeps the model its definition declares', () => {
    const agents = agentsOf({
      cheap: { description: 'd', prompt: 'p', model: { id: 'openai/gpt-5-mini' } },
    })
    expect(agents.cheap?.model).toEqual({ id: 'openai/gpt-5-mini' })
  })

  it('a registered subagent keeps its mcpServers', () => {
    const agents = agentsOf({
      a: { description: 'd', prompt: 'p', mcpServers: ['docs'] },
    })
    expect(agents.a?.mcpServers).toEqual(['docs'])
  })

  describe('a discovered definition', () => {
    let root: string
    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), 'subagent-registration-'))
      mkdirSync(join(root, '.theokit', 'agents'), { recursive: true })
      writeFileSync(
        join(root, '.theokit', 'agents', 'cheap.md'),
        '---\nname: cheap\ndescription: runs cheap\nmodel: inherit\n---\nBody.\n',
      )
    })
    afterAll(() => rmSync(root, { recursive: true, force: true }))

    it('carries its model into the options handed to Agent.create', async () => {
      const found = await discoverSubagents(root)
      const list = (Array.isArray(found) ? found : Object.values(found ?? {})) as unknown[]
      const def = ((list[0] as { definition?: unknown }).definition ?? list[0]) as {
        description: string
        prompt: string
        model?: SubagentAgentDefinition['model']
      }
      expect(def.model).toBe('inherit')
      const agents = agentsOf({
        cheap: { description: def.description, prompt: def.prompt, model: def.model },
      })
      expect(agents.cheap?.model).toBe('inherit')
    })
  })
})
