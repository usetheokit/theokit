import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

import { confirmBacktrack as confirmBacktrackCmd, primeBacktrack } from './backtrack.js'
import { armLadder, CLOSED_LADDER, selectTurn, type LadderState } from './backtrack-ladder.js'

export type BacktrackDeps = Pick<
  Parameters<typeof confirmBacktrackCmd>[1],
  'agent' | 'stdout' | 'setToast' | 'setClearEpoch' | 'currentSessionId' | 'setSessionAndPersist'
>

export interface BacktrackLadder {
  readonly armed: boolean
  readonly rotating: boolean
  readonly nth: number
  readonly total: number
  readonly previews: readonly string[]
  readonly composerSeed: string
  readonly setSeed: Dispatch<SetStateAction<string>>

  readonly prime: () => void
  readonly advance: (next: number, total: number) => void
  readonly reset: () => void
  readonly confirm: () => void
}

function requestBacktrackWindow(
  currentSessionId: BacktrackDeps['currentSessionId'],
  setToast: BacktrackDeps['setToast'],
  apply: (ladder: LadderState) => void,
): void {
  let previewWindow: readonly string[] = []
  let turnCount = 0
  void primeBacktrack({
    currentSessionId,
    setRewindPreviews: (p) => {
      previewWindow = typeof p === 'function' ? p([...previewWindow]) : p
    },
    setRewindCount: (n) => {
      turnCount = typeof n === 'function' ? n(turnCount) : n
    },
    setRewindNth: () => undefined,
    setRewindPrimed: (v) => {
      if (v) apply(armLadder(previewWindow, turnCount))
    },
    setToast,
  })
}

export function useBacktrack(deps: BacktrackDeps): BacktrackLadder {
  const [ladder, setLadder] = useState<LadderState>(CLOSED_LADDER)
  const [rotating, setRotating] = useState(false)
  const [composerSeed, setComposerSeedState] = useState('')

  const { setToast, currentSessionId } = deps

  const reset = useCallback((): void => {
    setLadder(CLOSED_LADDER)
  }, [])

  const prime = useCallback((): void => {
    requestBacktrackWindow(currentSessionId, setToast, setLadder)
  }, [currentSessionId, setToast])

  const advance = useCallback(
    (next: number, turnCount: number): void => {
      setLadder((current) => selectTurn(current, next))
      setToast({
        message: `Backtrack: message ${String(next + 1)}/${String(turnCount)} — Enter to edit, Esc for older`,
        variant: 'info',
      })
    },
    [setToast],
  )

  const confirm = useCallback((): void => {
    void confirmBacktrackCmd(
      { rewindNth: ladder.nth },
      {
        ...deps,
        setComposerSeed: setComposerSeedState,
        resetBacktrack: reset,
        setRotating,
      },
    )
  }, [ladder.nth, deps, reset])

  return {
    armed: ladder.armed,
    rotating,
    nth: ladder.nth,
    total: ladder.total,
    previews: ladder.previews,
    composerSeed,
    setSeed: setComposerSeedState,
    prime,
    advance,
    reset,
    confirm,
  }
}
