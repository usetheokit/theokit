/**
 * The agents producer types fit the presenter's wire reader types, so the two cannot drift.
 */
import type { AgentStopReason, AgentTurnMetadata } from '@theokit/agents/bridge'
import type { WireStopReason, WireTurnMetadata } from '@theokit/presenter/wire'
import { expectTypeOf } from 'vitest'

expectTypeOf<AgentTurnMetadata>().toExtend<WireTurnMetadata>()
expectTypeOf<AgentStopReason>().toExtend<WireStopReason>()
