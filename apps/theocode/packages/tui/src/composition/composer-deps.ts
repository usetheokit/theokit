/**
 * B-085 — the composer's dependency bundle.
 *
 * Extracted so adding one field to it stops costing the composition root a line of its budget. That
 * budget is not bureaucracy: the root is where every wire meets, and one that keeps absorbing
 * argument literals becomes the file nobody can read. B-075 is the measured case — a single new
 * field produced two lint errors and had to be reverted.
 */
import type { Dispatch, SetStateAction } from 'react'

import { useComposerCommands } from '../commands/index.js'
import { useGoalRun } from '../persistence/index.js'
import { useScreenState } from '../rendering/index.js'
import { useBacktrack } from '../backtrack/index.js'
import { type ApprovalMode } from '../consent/index.js'
import { useTuiSession } from './use-tui-session.js'

export function composerDeps(
  s: ReturnType<typeof useTuiSession>,
  screen: ReturnType<typeof useScreenState>,
  extra: {
    backtrack: ReturnType<typeof useBacktrack>
    goalAbort: { current: AbortController | null }
    lastSentMessage: { current: string | null }
    approvalMode: ApprovalMode
    goalRun: ReturnType<typeof useGoalRun>['goalRun']
    goalActive: boolean
    /** #58 — read once by the composition root; `/usage` and the Escape ladder both consume it. */
    hasLastUsage: boolean
    setGoalRun: ReturnType<typeof useGoalRun>['setGoalRun']
    credential: Parameters<typeof useComposerCommands>[0]['credential']
    setApprovalMode: Dispatch<SetStateAction<ApprovalMode>>
  },
  /** B-075 — the timeline, threaded to the command layer. B-085 made this affordable. */
  events: readonly unknown[],
) {
  const {
    backtrack,
    goalAbort,
    lastSentMessage,
    approvalMode,
    goalRun,
    goalActive,
    hasLastUsage,
    setGoalRun,
    setApprovalMode,
    credential,
  } = extra
  return {
    events,
    agent: s.agent,
    agentRef: s.agentRef,
    SESSION: s.SESSION,
    ptyOwner: s.ptyOwner,
    customCommands: s.customCommands,
    customCommandNames: s.customCommandNames,
    backtrack,
    goalAbort,
    lastSentMessage,
    stdout: s.stdout,
    writeToScrollback: s.writeToScrollback,
    approvalMode,
    goalRun,
    goalActive,
    hasLastUsage,
    currentSessionId: s.currentSessionId,
    forkCurrentSession: s.forkCurrentSession,
    resetSession: s.resetSession,
    // B-087 — the repointing seam and the turn state, so `/resume` can move the session and refuse
    // to do it under a running turn.
    setSessionAndPersist: s.setSessionAndPersist,
    streaming: s.streaming,
    credential,
    exit: s.exit,
    ...screen,
    setEffort: s.setEffort,
    setApprovalMode,
    setGoalRun,
  }
}
