import { describe, it, expectTypeOf } from 'vitest'
import { generateAgentRoutes, type AgentRoute } from '../../src/bridge/agent-route-generator.js'

describe('generateAgentRoutes types', () => {
  it('generateAgentRoutes accepts a context without compiledOptions', () => {
    const routes = generateAgentRoutes({
      walkResult: { route: '/api/agents/support' },
      createRun: async function* () {},
    })
    expectTypeOf(routes).toEqualTypeOf<AgentRoute[]>()
  })
})
