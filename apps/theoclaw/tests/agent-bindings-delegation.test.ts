import { describe, expect, it, vi } from 'vitest'

const agentFor = vi.fn((_event: unknown) => 'work')
const createAgentBindings = vi.fn((_options: unknown) => ({ agentFor }))

vi.mock('@theokit/gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@theokit/gateway')>()),
  createAgentBindings,
}))

const { createAgentRouter } = await import('../src/routing/routing-env.js')

describe('the agent router delegates to the gateway bindings', () => {
  it('builds the bindings from its config and answers with the agent they choose', () => {
    const routes = [{ agent: 'work', platform: 'slack' }]
    const router = createAgentRouter({
      defaultAgent: 'main',
      agents: [
        { id: 'main', workspace: '/m' },
        { id: 'work', workspace: '/w' },
      ],
      routes,
    })
    expect(createAgentBindings).toHaveBeenCalledWith({
      defaultAgent: 'main',
      agents: ['main', 'work'],
      rules: routes,
      accountOf: expect.any(Function),
    })
    // The platform here has no rule of its own: only the bindings can have answered "work".
    expect(router.route({ platform: 'telegram', peer: 'u1' }).id).toBe('work')
    expect(agentFor).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'telegram', sender: { id: 'u1' } }),
    )
  })
})
