import { expectTypeOf, it } from 'vitest'

import { buildAgentCard } from '../../src/a2a-entry.js'
import type { AgentCard } from '../../src/a2a-entry.js'

it('the plain form needs no AgentManifestEntry', () => {
  expectTypeOf(
    buildAgentCard({ name: 'a', route: '/a', baseUrl: 'https://x' }),
  ).toEqualTypeOf<AgentCard>()
})
