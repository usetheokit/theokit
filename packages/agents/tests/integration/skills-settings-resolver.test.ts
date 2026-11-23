/**
 * A `skills` resolver that returns an SDK `SkillsSettings` object (TheoClaw's shape) reaches
 * `Agent.create` on the agent-factory path in BOTH `skill_read` modes, not only `'advertised'`.
 */
import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ lastOpts: undefined as unknown }))

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn(async (_id: string, opts: unknown) => {
      h.lastOpts = opts
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

const { AgentBuilder } = await import('../../src/bridge/agent-builder.js')
const { toAgentFactory } = await import('../../src/bridge/sdk-adapter.js')

const settings = { bundledDirs: ['/skills'], skillsDir: '/skills' }

async function skillsReceived(read: 'inline' | 'advertised' | undefined, resolver: never) {
  const builder = AgentBuilder.create().model('m').context({ tenant: 'acme' })
  const def = (read ? builder.skills(resolver, { read }) : builder.skills(resolver)).build()
  await toAgentFactory(def as never, {
    apiKey: 'k',
    approvals: { kind: 'auto-reject', reason: 'test' },
  })('s1')
  return (h.lastOpts as { skills?: unknown }).skills
}

describe('a skills resolver returning SkillsSettings', () => {
  beforeEach(() => {
    h.lastOpts = undefined
  })

  it.each([undefined, 'inline', 'advertised'] as const)(
    'reaches Agent.create unchanged in read mode %s',
    async (read) => {
      const seen: unknown[] = []
      const resolver = ((ctx: unknown) => {
        seen.push(ctx)
        return settings
      }) as never
      expect(await skillsReceived(read, resolver)).toEqual(settings)
      expect(seen).toEqual([{ tenant: 'acme' }])
    },
  )

  it.each([undefined, 'advertised'] as const)(
    'a name-list resolver becomes skills.enabled in read mode %s',
    async (read) => {
      const resolver = (() => ['a', 'b']) as never
      expect(await skillsReceived(read, resolver)).toEqual({
        enabled: ['a', 'b'],
        autoInject: true,
      })
    },
  )
})
