/**
 * The agents producer types fit the presenter's wire reader types, so the two cannot drift.
 * Both are imported from source, not the built `dist` declarations, so a stale build cannot hide drift.
 */
import type { AgentStopReason, AgentTurnMetadata } from '../../src/bridge/agent-stream-events.js'
import type { WireStopReason, WireTurnMetadata } from '../../../presenter/src/wire/turn-metadata.js'
import { expectTypeOf } from 'vitest'

expectTypeOf<AgentTurnMetadata>().toExtend<WireTurnMetadata>()
expectTypeOf<AgentStopReason>().toExtend<WireStopReason>()
