import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import type { ReasoningEffort } from '@theocode/agent/config'
import type { AttachedImage } from '@theocode/agent/context'
import type { ApprovalMode } from '../consent/index.js'
import type { Mode, ContentPanel, ToastPayload } from '../screen-types.js'
import type { CustomCommand } from './custom-commands.js'
import type { GoalRunState } from './goal.js'

export interface SessionTheInterpreterUses {
  attachImages: (images: AttachedImage[] | undefined) => void
  effort: () => ReasoningEffort
  setEffort: (level: ReasoningEffort) => void
  cfg: () => { modelLabel: string; sandboxLabel: string; sandboxDetail: string; memory: boolean }
  sessionModel: () => string | undefined
  setSessionModel: (model: string) => void
  setModel: (model: string | undefined) => void
  session: () => string
}

export interface PtysTheInterpreterUses {
  backend: () => { activeSessionCount: () => number; killAll: () => void }
}

interface BacktrackUsedByInterpreter {
  setSeed: Dispatch<SetStateAction<string>>
}

export interface AgentTheInterpreterUses {
  send: (input: { message: string }) => void
  reset: () => void
  abort: () => void
}

export interface CommandCapabilities {
  readonly agent: AgentTheInterpreterUses
  readonly SESSION: SessionTheInterpreterUses
  readonly ptyOwner: PtysTheInterpreterUses
  readonly customCommands: ReadonlyMap<string, CustomCommand>
  readonly backtrack: BacktrackUsedByInterpreter
  readonly goalAbort: MutableRefObject<AbortController | null>
  readonly lastSentMessage: MutableRefObject<string | null>
  readonly stdout: { write: (s: string) => void } | undefined
  /**
   * Ink's `useStdout().write` — text placed ABOVE the live frame, in the terminal's own scrollback.
   *
   * A second seam onto the same stream as `stdout`, and the distinction is the whole point. Writing
   * to `stdout` lands inside the region Ink repaints, so the next frame erases it; this one erases
   * the frame first, writes verbatim, and repaints underneath. `/clear` wants the former (it is
   * addressing the screen), `/raw` wants the latter (it is addressing the scrollback), and calling
   * one where the other belongs fails silently in both directions.
   */
  readonly writeToScrollback: (text: string) => void
  readonly approvalMode: ApprovalMode
  readonly goalRun: GoalRunState | null
  readonly goalActive: boolean
  /** B-075 — the timeline, so /copy and /export read MESSAGES rather than the wrapped frame. */
  readonly events: readonly unknown[]
  /**
   * #58 — whether the last turn left usage to draw. The usage panel renders on
   * `showUsage && lastUsage`, so `/usage` before the first turn used to flip a toggle with nothing
   * behind it: no panel, and no word about why.
   */
  readonly hasLastUsage: boolean
  readonly currentSessionId: () => string
  readonly forkCurrentSession: () => { newId: string; copied: boolean }
  readonly resetSession: () => void
  /** B-087 — repoints the live session, the same seam `backtrack` uses to move after a fork. */
  readonly setSessionAndPersist: (id: string) => void
  /** B-087 — a session cannot be swapped under a turn that is still running. */
  readonly streaming: boolean
  readonly startGoal: (
    objective: string,
    base?: { turns: number; tokens: number; startedAt: number },
  ) => void
  readonly exit: () => void
  readonly setToast: Dispatch<SetStateAction<ToastPayload | null>>
  readonly setPanel: Dispatch<SetStateAction<ContentPanel | undefined>>
  readonly setMode: Dispatch<SetStateAction<Mode>>
  readonly setShowHelp: Dispatch<SetStateAction<boolean>>
  readonly setShowUsage: Dispatch<SetStateAction<boolean>>
  readonly setClearEpoch: Dispatch<SetStateAction<number>>
  /** #70 — whether the conversation on screen continues an earlier one. `/resume` sets it, `/new` clears it. */
  readonly setResumed: Dispatch<SetStateAction<boolean>>
  readonly setEffort: Dispatch<SetStateAction<ReasoningEffort>>
  readonly setApprovalMode: Dispatch<SetStateAction<ApprovalMode>>
  readonly setGoalRun: Dispatch<SetStateAction<GoalRunState | null>>
  readonly setGoalFeed: Dispatch<SetStateAction<string | null>>
  readonly setLoginProvider: Dispatch<SetStateAction<string | undefined>>
  readonly setReviewResult: Dispatch<SetStateAction<string | null>>
}

export type SessionAndScreenCapabilities = Pick<
  CommandCapabilities,
  | 'agent'
  | 'SESSION'
  | 'backtrack'
  | 'goalAbort'
  | 'stdout'
  | 'resetSession'
  | 'setSessionAndPersist'
  | 'streaming'
  | 'setToast'
  | 'setShowHelp'
  | 'setShowUsage'
  // #58 — `/usage` refuses instead of arming a panel that cannot render.
  | 'hasLastUsage'
  | 'setClearEpoch'
  | 'setEffort'
  | 'setGoalRun'
  | 'setGoalFeed'
  // #70 — `/new` and `/clear` clear the continuation flag, so the greeting stops announcing one and
  // the restored turns leave with the command that ended the conversation.
  | 'setResumed'
>

export type IdentityCapabilities = Pick<
  CommandCapabilities,
  | 'currentSessionId'
  | 'forkCurrentSession'
  | 'resetSession'
  | 'setToast'
  | 'setLoginProvider'
  // B-087 — /resume lives with the other session verbs and needs the repointing seam.
  | 'setSessionAndPersist'
  | 'setClearEpoch'
  // #70 — and the flag that makes the resumed state visible, which is the half that was missing.
  | 'setResumed'
  | 'streaming'
>

export type TurnCapabilities = Pick<
  CommandCapabilities,
  | 'agent'
  | 'SESSION'
  | 'customCommands'
  | 'lastSentMessage'
  | 'setToast'
  | 'setMode'
  | 'setApprovalMode'
>

export type InspectionCapabilities = Pick<
  CommandCapabilities,
  | 'agent'
  | 'SESSION'
  | 'ptyOwner'
  | 'lastSentMessage'
  | 'approvalMode'
  | 'currentSessionId'
  | 'events'
  | 'exit'
  | 'setToast'
  | 'setPanel'
  // `/raw` lives in the transcript-out group, which is typed by this pick.
  | 'writeToScrollback'
>

/**
 * What the read-only settings commands need: the two posture values, and the two ways to say them.
 *
 * Deliberately WITHOUT `setApprovalMode` — the panel these back is a report, and handing it the
 * setter is how a report grows a second way to change a value that `/sandbox` guards with an armed
 * confirmation.
 */
export type SettingsCapabilities = Pick<
  CommandCapabilities,
  'SESSION' | 'approvalMode' | 'setToast' | 'setPanel'
>

export type ShellCapabilities = Pick<CommandCapabilities, 'ptyOwner' | 'setToast'>

export type SteeringCapabilities = Pick<
  CommandCapabilities,
  | 'agent'
  | 'backtrack'
  | 'goalAbort'
  | 'lastSentMessage'
  | 'goalRun'
  | 'goalActive'
  | 'currentSessionId'
  | 'startGoal'
  | 'setToast'
  | 'setClearEpoch'
  | 'setGoalRun'
  | 'setGoalFeed'
  | 'setReviewResult'
>
