/**
 * agent-saas (M4) — the human-facing side of the harness.
 *
 * `useAgent('/api/agents/ops')` streams the `ops` agent. When it wants to run the HITL-gated
 * `ops.deploy` tool, the run PAUSES and the stream carries a `tool-approval-request` part. This page
 * renders Approve / Deny, which POST the decision to `/api/agents/ops/approve/<approvalId>` — that
 * resolves the paused SDK hook, and the same open stream continues (approved → the tool runs;
 * denied → the model gets the denial and carries on).
 *
 * Illustrative pattern (not a framework primitive): the approval UI is app code over the wire.
 */
import { useCallback, useState } from 'react'
import { useAgent } from 'theokit/client'

/** A pending approval surfaced by the stream: the id to resolve + what the agent wants to do. */
interface PendingApproval {
  approvalId: string
  toolName: string
  question: string
}

/** Scan the reconstructed messages for an unresolved `tool-approval-request` part. */
function findPendingApproval(messages: { parts?: unknown[] }[]): PendingApproval | null {
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const p = part as { type?: string; approvalId?: string; toolName?: string }
      if (p.type === 'tool-approval-request' && typeof p.approvalId === 'string') {
        return {
          approvalId: p.approvalId,
          toolName: p.toolName ?? 'tool',
          question: 'Approve this action?',
        }
      }
    }
  }
  return null
}

export default function OpsConsole() {
  const { messages, status, send } = useAgent('/api/agents/ops')
  const [resolved, setResolved] = useState<Set<string>>(new Set())

  const respond = useCallback(async (approvalId: string, approved: boolean) => {
    // Resolve the paused run — the open stream continues with the decision.
    await fetch(`/api/agents/ops/approve/${approvalId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Theo-Action': '1' },
      body: JSON.stringify({ approved }),
    })
    setResolved((prev) => new Set(prev).add(approvalId))
  }, [])

  const pending = findPendingApproval(messages as { parts?: unknown[] }[])
  const showApproval = pending && !resolved.has(pending.approvalId)

  return (
    <main>
      <h1>Ops agent</h1>
      <button onClick={() => send({ prompt: 'Deploy the billing service to production' })}>
        Ask to deploy
      </button>
      <p>status: {status}</p>

      {showApproval && (
        <div role="alertdialog">
          <p>
            The agent wants to run <strong>{pending.toolName}</strong>. {pending.question}
          </p>
          <button onClick={() => void respond(pending.approvalId, true)}>Approve</button>
          <button onClick={() => void respond(pending.approvalId, false)}>Deny</button>
        </div>
      )}

      <pre>{JSON.stringify(messages, null, 2)}</pre>
    </main>
  )
}
