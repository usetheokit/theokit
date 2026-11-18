/**
 * The agents producer types fit the presenter's wire reader types, so the two cannot drift.
 */
import type { AgentStopReason, AgentTurnMetadata } from '../../src/bridge/agent-stream-events.js'
import type { WireStopReason, WireTurnMetadata } from '@theokit/presenter/wire'
import { expectTypeOf } from 'vitest'

expectTypeOf<AgentTurnMetadata>().toExtend<WireTurnMetadata>()
expectTypeOf<AgentStopReason>().toExtend<WireStopReason>()
