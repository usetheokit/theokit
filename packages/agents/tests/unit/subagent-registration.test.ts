import 'reflect-metadata'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverSubagents } from '@theokit/sdk/subagents-loader'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SubagentAgentDefinition } from '../../src/bridge/define-agent.js'

const h = vi.hoisted(() => ({ created: [] as Record<string, unknown>[] }))

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn(async (id: string, opts: Record<string, unknown>) => {
      h.created.push(opts)
      return {
        agentId: id,
        send: async () => ({
          events: async function* () {
            yield { kind: 'message', message: { type: 'status', status: 'FINISHED' } }
          },
          wait: async () => ({}),
        }),
        dispose: async () => {},
      }
    }),
  },
}))

const { AgentBuilder } = await import('../../src/bridge/agent-builder.js')
const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { compileAgentDefinition } = await import('../../src/bridge/define-agent.js')

let session = 0

/** Registers through `AgentBuilder.subagents()`, runs a turn, and returns `agents` as handed to the SDK. */
async function agentsHandedToTheSdk(
  subagents: Record<string, SubagentAgentDefinition>,
): Promise<Record<string, Record<string, unknown>>> {
  h.created.length = 0
  const def = AgentBuilder.create().model('openai/gpt-5.4').subagents(subagents).build()
  const stream = createSdkAgentStream(
    compileAgentDefinition(def),
    [],
    'test-key',
  )('go', `sess-${++session}`)
  for await (const event of stream) expect(event).toBeDefined()
  const opts = h.created[0]
  if (opts === undefined) throw new Error('Agent.getOrCreate was never called')
  return opts.agents as Record<string, Record<string, unknown>>
}

describe('registering a subagent keeps what its definition declares', () => {
  beforeEach(() => {
    h.created.length = 0
  })

  it('a registered subagent keeps the model its definition declares', async () => {
    const agents = await agentsHandedToTheSdk({
      cheap: { description: 'd', prompt: 'p', model: { id: 'openai/gpt-5-mini' } },
    })
    expect(agents.cheap?.model).toEqual({ id: 'openai/gpt-5-mini' })
  })

  it('a registered subagent keeps its mcpServers', async () => {
    const agents = await agentsHandedToTheSdk({
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
      const agents = await agentsHandedToTheSdk({
        cheap: { description: def.description, prompt: def.prompt, model: def.model },
      })
      expect(agents.cheap?.model).toBe('inherit')
    })
  })
})
