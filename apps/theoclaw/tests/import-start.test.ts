import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Agent } from '@theokit/sdk'
import type { AgentOptions, SDKAgent } from '@theokit/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../src/agent/create-agent.js'
import type { TheoClawAgentOptions } from '../src/agent/create-agent.js'
import { createAgentFactory, createChannelAgentFactory } from '../src/control-plane/agent-factory.js'
import type { TurnAgent } from '../src/control-plane/turn.js'
import { readClaudeCodeSetup } from '../src/migration/claude-code-source.js'
import { readHermesSetup } from '../src/migration/hermes-source.js'
import { type ImportedSetup, readImport, writeImport } from '../src/migration/import-store.js'
import { copyFixture } from './migration-fixtures.js'

const ENV = { THEOCLAW_MODEL: 'openrouter/m', OPENROUTER_API_KEY: 'router-key' }
const now = new Date('2026-10-31T12:00:00Z')
const unusedAgent: TurnAgent = { send: () => Promise.reject(new Error('not used')) }

interface Expected {
  readonly instruction: string
  readonly memory: string
  readonly skills: string[]
  readonly servers: string[]
}

/** Claude Code's project-directory encoding (`session-transcript.ts:52-53` in the SDK). */
function encode(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}

function recording(): { create: (options: TheoClawAgentOptions) => Promise<TurnAgent>; options: TheoClawAgentOptions[] } {
  const options: TheoClawAgentOptions[] = []
  return {
    options,
    create: async (passed) => {
      options.push(passed)
      return unusedAgent
    },
  }
}

/** FR-008, FR-009, FR-012 (AC-012, AC-013): what an import gives the `/control` agent, and the channel agent. */
describe('an import reaching the agents', () => {
  let dir = ''
  const imports: Record<string, { setup: ImportedSetup; expected: Expected }> = {}

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'theoclaw-migration-')))
    const claude = copyFixture('claude-code', join(dir, 'claude'))
    const project = join(claude, 'project')
    // Not a repository, so the project itself keys the auto memory.
    const projects = join(claude, 'home', '.claude', 'projects', encode(project))
    mkdirSync(projects, { recursive: true })
    renameSync(join(claude, 'memory'), join(projects, 'memory'))
    writeImport(join(dir, 'state-claude'), readClaudeCodeSetup({ home: join(claude, 'home'), project }), { now })
    const hermes = copyFixture('hermes', join(dir, 'hermes'))
    writeImport(join(dir, 'state-hermes'), readHermesSetup({ root: hermes }), { now })
    imports['claude-code'] = {
      setup: readImport(join(dir, 'state-claude'))!,
      expected: {
        instruction: 'Fixture project instruction: the project is called Lighthouse.',
        memory: "Fixture memory: the owner's favourite colour is teal.",
        skills: ['user-skill', 'shared-skill'],
        servers: ['db', 'search', 'shared'],
      },
    }
    imports.hermes = {
      setup: readImport(join(dir, 'state-hermes'))!,
      expected: {
        instruction: "Fixture Hermes agents note: the owner's team is called Orbit.",
        memory: 'Fixture Hermes memory: the owner runs on Tuesdays.',
        skills: ['hermes-skill'],
        servers: ['files', 'web'],
      },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  for (const kind of ['claude-code', 'hermes'] as const) {
    it(`a ${kind} import reaches the control agent options and Agent.create`, async () => {
      const { setup, expected } = imports[kind]!
      const off = recording()
      const on = recording()

      await createAgentFactory(ENV, off.create, { setup, mcp: false })()
      await createAgentFactory(ENV, on.create, { setup, mcp: true })()

      const options = off.options[0]!
      expect(options.systemPrompt).toContain(expected.instruction)
      expect(options.systemPrompt).toContain(`## Imported memory (read-only)\n\n`)
      expect(options.systemPrompt!.indexOf(expected.memory)).toBeGreaterThan(options.systemPrompt!.indexOf('## Imported memory (read-only)'))
      expect([...(options.skills?.inline ?? [])].map((skill) => skill.name).sort()).toEqual([...expected.skills].sort())
      expect(options.tools?.map((tool) => tool.name)).toContain('skill_read')
      expect(options.mcpServers).toBeUndefined()
      expect(options.memory).toEqual({ enabled: false })
      expect(options.withheldBuiltinTools).toEqual(['shell'])
      expect(Object.keys(on.options[0]!.mcpServers ?? {}).sort()).toEqual([...expected.servers].sort())

      const passed: AgentOptions[] = []
      vi.spyOn(Agent, 'create').mockImplementation(async (sdkOptions) => {
        passed.push(sdkOptions as AgentOptions)
        return {} as SDKAgent
      })
      await createTheoClawAgent(on.options[0]!)
      expect(passed[0]?.systemPrompt).toBe(on.options[0]!.systemPrompt)
      expect(passed[0]?.skills).toEqual(on.options[0]!.skills)
      expect(passed[0]?.mcpServers).toEqual(on.options[0]!.mcpServers)
      expect(passed[0]?.memory).toEqual({ enabled: false })
    })
  }

  it('a channel agent receives nothing from an import', async () => {
    const withImport = recording()
    const without = recording()

    // The import goes to the `/control` factory only; the channel factory takes none.
    await createAgentFactory(ENV, recording().create, { setup: imports.hermes!.setup, mcp: true })()
    await createChannelAgentFactory(ENV, withImport.create)()
    await createChannelAgentFactory(ENV, without.create)()

    expect(withImport.options[0]).toEqual(without.options[0])
    expect(withImport.options[0]).toEqual(theoClawAgentOptions({ model: 'openrouter/m', apiKey: 'router-key' }))
    expect(withImport.options[0]).not.toHaveProperty('systemPrompt')
    expect(withImport.options[0]).not.toHaveProperty('skills')
    expect(withImport.options[0]).not.toHaveProperty('mcpServers')
  })

  it('an import with no instruction, memory, skill or server adds nothing to the control agent', async () => {
    const empty: ImportedSetup = {
      kind: 'hermes',
      instructions: '',
      memory: '',
      mcpServers: {},
      skills: [],
      counts: { instructions: 0, memories: 0, skills: 0, mcpServers: 0 },
    }
    const withEmpty = recording()
    const without = recording()

    await createAgentFactory(ENV, withEmpty.create, { setup: empty, mcp: true })()
    await createAgentFactory(ENV, without.create)()

    expect(withEmpty.options[0]).toEqual(without.options[0])
  })
})
