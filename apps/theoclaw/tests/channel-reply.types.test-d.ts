import type { SDKAgent } from '@theokit/sdk'

import type { TurnAgent } from '../src/channels/reply-handler.js'

/**
 * The real agent fits the port the reply handler takes. The port's stream element is the narrow
 * `{ type }`; typed with the presenter's `SdkMessage`, whose index signature the SDK's message
 * interfaces do not declare, this assignment fails with TS2322 (Codex finding
 * `pj_turn_agent_port_rejects_sdk_agent`). Checked by `tsc -p tsconfig.test.json`.
 */
declare const agent: SDKAgent

export const fitsThePort: TurnAgent = agent
