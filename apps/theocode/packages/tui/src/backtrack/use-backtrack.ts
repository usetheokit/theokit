import { backtrackReducer, CLOSED_BACKTRACK, type BacktrackState } from '@theokit/tui'
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { confirmBacktrack as confirmBacktrackCmd, primeBacktrack } from './backtrack.js'

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
  apply: (previews: readonly string[]) => void,
): void {
  let previewWindow: readonly string[] = []
  void primeBacktrack({
    currentSessionId,
    setRewindPreviews: (p) => {
      previewWindow = typeof p === 'function' ? p([...previewWindow]) : p
    },
    setRewindCount: () => undefined,
    setRewindNth: () => undefined,
    setRewindPrimed: (v) => {
      if (v) apply(previewWindow)
    },
    setToast,
  })
}

export function useBacktrack(deps: BacktrackDeps): BacktrackLadder {
  const [ladder, setLadderState] = useState<BacktrackState>(CLOSED_BACKTRACK)
  const ladderRef = useRef<BacktrackState>(CLOSED_BACKTRACK)
  const setLadder = useCallback((update: (current: BacktrackState) => BacktrackState): void => {
    ladderRef.current = update(ladderRef.current)
    setLadderState(ladderRef.current)
  }, [])
  const [rotating, setRotating] = useState(false)
  const [composerSeed, setComposerSeedState] = useState('')

  const { setToast, currentSessionId } = deps

  const reset = useCallback((): void => {
    setLadder((current) => backtrackReducer(current, { type: 'reset' }))
  }, [setLadder])

  const prime = useCallback((): void => {
    requestBacktrackWindow(currentSessionId, setToast, (previews) => {
      setLadder((current) => backtrackReducer(current, { type: 'prime', previews }))
    })
  }, [currentSessionId, setToast, setLadder])

  const advance = useCallback(
    (_next: number, turnCount: number): void => {
      // The reducer is the one authority on the position: the toast reports where it landed, not
      // the caller's idea of where it would.
      const landed = backtrackReducer(ladderRef.current, { type: 'older' })
      ladderRef.current = landed
      setLadderState(landed)
      setToast({
        message: `Backtrack: message ${String(landed.selected + 1)}/${String(turnCount)} — Enter to edit, Esc for older`,
        variant: 'info',
      })
    },
    [setToast],
  )

  const confirm = useCallback((): void => {
    void confirmBacktrackCmd(
      { rewindNth: ladder.selected },
      {
        ...deps,
        setComposerSeed: setComposerSeedState,
        resetBacktrack: reset,
        setRotating,
      },
    )
  }, [ladder.selected, deps, reset])

  return {
    armed: ladder.armed,
    rotating,
    nth: ladder.selected,
    total: ladder.previews.length,
    previews: ladder.previews,
    composerSeed,
    setSeed: setComposerSeedState,
    prime,
    advance,
    reset,
    confirm,
  }
}
