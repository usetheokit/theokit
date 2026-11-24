import type { SDKAgent } from '@theokit/sdk'
import { expectTypeOf, it } from 'vitest'

import type { TurnAgent, TurnRun } from '../src/agent-port.js'

it('an SDKAgent and its run are the port, with no cast', () => {
  expectTypeOf<SDKAgent>().toExtend<TurnAgent>()
  expectTypeOf<Awaited<ReturnType<SDKAgent['send']>>>().toExtend<TurnRun>()
})
