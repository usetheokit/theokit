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

/**
 * The answer to each `session/request_permission` of one ACP agent: granted only on the owner's
 * yes, once (`always` is not remembered); refused on a no, a timeout, a failed question or no
 * asker. Never throws.
 */
export function acpPermissionHandler(agent: string, options: AcpPermissionOptions): (params: unknown) => Promise<Decision> {
  const { ask, timeoutMs = ACP_PERMISSION_TIMEOUT_MS } = options
  return async (params) => {
    if (ask === undefined) return { granted: false }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'deny'>((resolve) => {
      timer = setTimeout(() => resolve('deny'), timeoutMs)
    })
    try {
      const reply = await Promise.race([ask(describeRequest(agent, params)), timeout])
      const answer = typeof reply === 'string' ? reply : reply.answer
      return { granted: answer === 'once' || answer === 'always' }
    } catch {
      return { granted: false }
    } finally {
      clearTimeout(timer)
    }
  }
}
