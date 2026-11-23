import type { SandboxPosture } from '@theokit/agents/sandbox'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ApprovalMode } from './approval-mode.js'
import { shouldAutoApprove } from './approval-mode.js'
import {
  createApprovalLedger,
  findNextApproval,
  ingest,
  prune,
  settle,
  type ApprovalLedger,
  type UIMessageLike,
} from '@theokit/tui'

/**
 * Drop settled entries whose message is no longer the last one. The toolkit keeps them until a
 * prune, which would suppress an approval id the agent reuses on a later message; the thread has
 * moved past them by then, so the marker has done its job (the ingest watermark keeps older
 * messages from being re-read and re-offered).
 */
export function dropDeadMarkers(ledger: ApprovalLedger, threadLength: number): ApprovalLedger {
  return {
    ...ledger,
    entries: ledger.entries.filter((e) => !(e.settled && e.messageIndex < threadLength - 1)),
  }
}

interface AgentWithApproval {
  thread: readonly UIMessageLike[]
  approve: (approvalId: string, decision: { approved: boolean }) => unknown
}

export interface Approvals {
  readonly pendingApproval: ReturnType<typeof findNextApproval>
  readonly settleApproval: (approvalId: string, approved: boolean) => void
}

export function useApprovals(
  agent: AgentWithApproval,
  approvalMode: ApprovalMode,
  sandboxPosture?: Pick<SandboxPosture, 'enforced' | 'detail'> & {
    readonly mode?: SandboxPosture['mode']
  },
): Approvals {
  const registry = useRef<ApprovalLedger>(createApprovalLedger())
  const [epoch, setEpoch] = useState(0)

  const pendingApproval = useMemo(() => {
    void epoch
    // The toolkit ledger is immutable: every step returns the next value, and a backtrack that cut
    // the thread is dropped by `prune` BEFORE `ingest` so a re-used message index is read again.
    registry.current = dropDeadMarkers(
      ingest(prune(registry.current, agent.thread.length), agent.thread),
      agent.thread.length,
    )
    return findNextApproval(registry.current)
  }, [agent.thread, epoch])

  const approve = agent.approve
  const settleApproval = useCallback(
    (approvalId: string, approved: boolean): void => {
      registry.current = settle(registry.current, approvalId)
      setEpoch((n) => n + 1)
      void approve(approvalId, { approved })
    },
    [approve],
  )

  useEffect(() => {
    // B-006 — auto-approval now depends on there actually being a sandbox. Without this the surface
    // approved every command under `full-auto` while rendering `⚠ tool-gating` on the same screen.
    if (
      pendingApproval &&
      shouldAutoApprove(approvalMode, pendingApproval.toolName, sandboxPosture)
    ) {
      settleApproval(pendingApproval.approvalId, true)
    }
  }, [pendingApproval, approvalMode, settleApproval, sandboxPosture])

  return { pendingApproval, settleApproval }
}
