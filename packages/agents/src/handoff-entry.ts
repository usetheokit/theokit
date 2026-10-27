/**
 * `@theokit/agents/handoff` — a conversation one agent can hand to another, so the next turn is
 * answered by the receiver.
 *
 * A subpath rather than a member of the root barrel: it is an app-facing orchestrator most agents
 * never import, and the root bundle sits close to its cap (B-410). It is not `@theokit/sdk-handoff`,
 * which is call-and-return: there the caller keeps the turn.
 */
export { createHandoffConversation, HandoffError } from './handoff/handoff-conversation.js'
export type {
  CreateHandoffConversationOptions,
  HandoffConversation,
  HandoffErrorCode,
  HandoffSendOptions,
  HandoffTransfer,
  HandoffTurn,
} from './handoff/handoff-conversation.js'
// The roster entry shape `agents` takes; named here so a consumer can type a roster.
export type { SubAgentSpec } from './bridge/agent-orchestrator.js'
