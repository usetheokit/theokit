import { useState, type Dispatch, type SetStateAction } from 'react'

import type { Mode, ContentPanel, ToastPayload } from '../screen-types.js'

import { resolveEffectiveConfig } from '@theocode/agent/config'

import { configHealthNotice } from '../config-health.js'
import { workingDirectory } from '../working-directory.js'
export type { ContentPanel }

export interface ScreenState {
  /**
   * Why the project configuration is not in force, when it is not. #827.
   *
   * `undefined` on a healthy boot — a notice on every good start is noise, and noise is what makes
   * a diagnostic stop being read.
   */
  readonly configNotice: string | undefined
  readonly clearEpoch: number
  readonly setClearEpoch: Dispatch<SetStateAction<number>>
  readonly composerText: string
  readonly setComposerText: Dispatch<SetStateAction<string>>
  readonly showHelp: boolean
  readonly setShowHelp: Dispatch<SetStateAction<boolean>>
  /**
   * Whether the timeline renders tool CARDS or a dim count line per run of adjacent calls.
   *
   * `false` is the default because that is what Claude Code shows, and because the collapsed form
   * is the one that survives a long turn: twelve cards push the answer off the screen, twelve calls
   * collapse to `Ran 12 shell commands` above it. ctrl+o flips it — a reading gesture, so a key
   * rather than a command.
   */
  readonly verbose: boolean
  readonly setVerbose: Dispatch<SetStateAction<boolean>>
  readonly showUsage: boolean
  readonly setShowUsage: Dispatch<SetStateAction<boolean>>
  readonly panel: ContentPanel | undefined
  readonly setPanel: Dispatch<SetStateAction<ContentPanel | undefined>>
  readonly exitArmed: boolean
  readonly setExitArmed: Dispatch<SetStateAction<boolean>>
  readonly mode: Mode
  readonly setMode: Dispatch<SetStateAction<Mode>>
  readonly toast: ToastPayload | null
  readonly setToast: Dispatch<SetStateAction<ToastPayload | null>>
  readonly reviewResult: string | null
  readonly setReviewResult: Dispatch<SetStateAction<string | null>>
  readonly goalFeed: string | null
  readonly setGoalFeed: Dispatch<SetStateAction<string | null>>
  readonly loginProvider: string | undefined
  readonly setLoginProvider: Dispatch<SetStateAction<string | undefined>>
  /**
   * Whether the conversation on screen continues an earlier one (#70).
   *
   * State rather than a derivation, because it changes for two reasons that have nothing else in
   * common: `/resume` sets it, `/new` clears it. Seeded from whether the process STARTED on a
   * session pointer, which is the only case that used to reach the greeting.
   */
  readonly resumed: boolean
  readonly setResumed: Dispatch<SetStateAction<boolean>>
}

export function useScreenState(resumedAtStartup = false): ScreenState {
  const [clearEpoch, setClearEpoch] = useState(0)
  const [resumed, setResumed] = useState(resumedAtStartup)
  const [composerText, setComposerText] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [verbose, setVerbose] = useState(false)
  const [showUsage, setShowUsage] = useState(false)
  const [panel, setPanel] = useState<ContentPanel | undefined>(undefined)
  const [exitArmed, setExitArmed] = useState(false)
  const [mode, setMode] = useState<Mode>('chat')
  const [toast, setToast] = useState<ToastPayload | null>(null)

  // #827 — the project configuration, checked on EVERY boot rather than once.
  //
  // The warning used to live inside the branch that runs when trust is GRANTED, so a file broken
  // after that point was dropped in silence: nothing on screen, nothing in the stderr log, and a
  // status bar showing defaults that look like a choice. `theocode doctor` exits 1 on the same file.
  //
  // Here because this is where the toast state is, and a notice that cannot reach the screen is the
  // log line this replaces. `useState` with an initialiser, not `useEffect`: the read happens once
  // per mount, before the first frame, so the operator sees it with the banner rather than after it.
  const [configNotice] = useState(() =>
    configHealthNotice(() => resolveEffectiveConfig({ cwd: workingDirectory() })),
  )

  const [reviewResult, setReviewResult] = useState<string | null>(null)
  const [goalFeed, setGoalFeed] = useState<string | null>(null)
  const [loginProvider, setLoginProvider] = useState<string | undefined>(undefined)
  return {
    configNotice,
    resumed,
    setResumed,
    clearEpoch,
    setClearEpoch,
    composerText,
    setComposerText,
    showHelp,
    setShowHelp,
    verbose,
    setVerbose,
    showUsage,
    setShowUsage,
    panel,
    setPanel,
    exitArmed,
    setExitArmed,
    mode,
    setMode,
    toast,
    setToast,
    reviewResult,
    setReviewResult,
    goalFeed,
    setGoalFeed,
    loginProvider,
    setLoginProvider,
  }
}
