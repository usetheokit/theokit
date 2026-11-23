import { createApprovalGate, type PermissionStore } from '@theokit/agents/auth'

import type { PersonReply } from './exec-approval.js'

/** How long the owner has to answer before the request is refused. */
export const ACP_PERMISSION_TIMEOUT_MS = 120_000

export interface AcpPermissionOptions {
  /** Asks the owner in the chat; the same asker as shell exec approval. Absent: every request is refused. */
  readonly ask?: (question: string) => Promise<PersonReply>
  readonly timeoutMs?: number
}

type Decision = { granted: boolean }

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** What the owner is shown: the agent's name and the step it wants to take. */
function describeRequest(agent: string, params: unknown): string {
  const toolCall = record(record(params).toolCall)
  const title = typeof toolCall.title === 'string' && toolCall.title !== '' ? toolCall.title : 'an action'
  const kind = typeof toolCall.kind === 'string' && toolCall.kind !== '' ? ` (${toolCall.kind})` : ''
  return `ACP agent ${agent} asks permission: ${title}${kind}`
}

/** A store that never holds a grant: the ACP path asks every time. */
const NO_GRANTS = { isGranted: () => false, grant: () => undefined } as unknown as PermissionStore

/**
 * The answer to each `session/request_permission` of one ACP agent: granted only on the owner's
 * yes, once (`always` is not remembered); refused on a no, a timeout, a failed question or no
 * asker. Never throws.
 */
export function acpPermissionHandler(agent: string, options: AcpPermissionOptions): (params: unknown) => Promise<Decision> {
  const { ask, timeoutMs = ACP_PERMISSION_TIMEOUT_MS } = options
  const gate = createApprovalGate({
    store: NO_GRANTS,
    key: () => ({ tool: 'acp', scope: agent, command: 'permission' }),
    persistAlways: false,
    recordUngoverned: false,
    timeoutMs,
    ask: ask === undefined ? undefined : (_query, ctx) => ask(describeRequest(agent, ctx.args)),
  })
  return async (params) => {
    const decision = await gate.decide({ name: 'acp_permission', args: params, agentId: agent, runId: 'acp' } as Parameters<typeof gate.decide>[0])
    return { granted: decision.allowed }
  }
}
