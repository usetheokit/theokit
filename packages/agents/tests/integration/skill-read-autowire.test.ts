/**
 * Auto-wiring `skill_read` for inline skills.
 *
 * BDD: Given `defineAgent({ skills: [inlineSkill] })`, When the agent runs, Then the SDK agent is created
 * with a `skill_read` tool — so one `.skills([...])` call both registers the skill into the `<skills>`
 * block (name + description) AND makes its body readable. Without the tool an inline skill's `instructions`
 * are unreachable to the model, so registering an inline skill implies wanting it readable.
 *
 * The auto-wire lives at the RUNTIME layer (`createSdkAgentStream`), where `@theokit/sdk` is dynamically
 * loaded — the pure compile module (`compileAgentDefinition`) keeps its type-only SDK dependency. This test
 * mocks `@theokit/sdk` so `getOrCreate` can capture the tools it receives and `SkillReadTool.create` is a
 * real factory. Dedup + graceful-degrade (older SDK without the factory) are covered too.
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Names of the tools `Agent.getOrCreate` was called with. */
  toolNames: [] as string[],
  /** Toggle: when false, the mocked SDK omits `SkillReadTool` (older-peer simulation). */
  provideReadTool: true,
}))

vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
    deleteConversation = async () => {}
  },
  FileSystemConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
    deleteConversation = async () => {}
  },
  // SE36 (SDK v3.0) — factories are `X.create()`.
  Tool: { create: (spec: { name: string }) => ({ name: spec.name }) },
  Skill: {
    create: (spec: { name: string; description: string; instructions: string }) => ({
      ...spec,
      source: `inline://${spec.name}`,
    }),
  },
  // Present only when the toggle is on — mirrors an SDK old enough to lack SE23.
  get SkillReadTool() {
    return h.provideReadTool
      ? {
          create: (skills: ReadonlyArray<{ name: string }>) => ({
            name: 'skill_read',
            covers: skills.length,
          }),
        }
      : undefined
  },
  Agent: {
    getOrCreate: vi.fn(async (_id: string, opts: { tools?: Array<{ name?: string }> }) => {
      h.toolNames = (opts.tools ?? []).map((t) => t?.name ?? '<anon>')
      return {
        send: async () => ({
          stream: async function* () {
            yield { type: 'status', status: 'FINISHED' }
          },
          wait: async () => ({}),
        }),
        dispose: async () => {},
      }
    }),
  },
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { compileAgentDefinition, defineAgent } = await import('../../src/bridge/define-agent.js')
const { Skill } = await import('@theokit/sdk')

const briefing = Skill.create({
  name: 'daily-briefing',
  description: 'A morning briefing',
  instructions: 'steps...',
})

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream) {
    // consume
  }
}

describe('skill_read is auto-wired for inline skills at runtime', () => {
  beforeEach(() => {
    h.toolNames = []
    h.provideReadTool = true
  })

  it('adds a skill_read tool when the agent declares an inline skill', async () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', skills: [briefing] }))
    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-1'))
    expect(h.toolNames).toContain('skill_read')
  })

  it('does NOT add skill_read for a pure filesystem-name selection', async () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', skills: ['fs-only'] }))
    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-2'))
    expect(h.toolNames).not.toContain('skill_read')
  })

  it('does NOT double-wire when the app already declared a skill_read tool (dedup)', async () => {
    const manual = { name: 'skill_read', description: 'mine', inputSchema: {}, handler: () => 'ok' }
    const compiled = compileAgentDefinition(
      defineAgent({ model: 'm', skills: [briefing], tools: [manual] }),
    )
    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-3'))
    expect(h.toolNames.filter((n) => n === 'skill_read')).toHaveLength(1)
  })

  it('degrades gracefully when the SDK lacks SkillReadTool (no crash, no tool)', async () => {
    h.provideReadTool = false
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', skills: [briefing] }))
    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-4'))
    expect(h.toolNames).not.toContain('skill_read')
  })
})
