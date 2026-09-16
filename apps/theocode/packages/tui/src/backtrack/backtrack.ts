import { CLEAR_SCREEN_AND_SCROLLBACK } from '@theokit/tui/terminal'
import { randomUUID } from 'node:crypto'

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Dispatch, SetStateAction } from 'react'

import {
  legacyRootHint,
  forkSessionBeforeUserTurn,
  readUserTurnPreviewsAsync,
} from '@theocode/agent/session'
import { SENTINEL } from './backtrack-select.js'
import type { ToastPayload } from '../screen-types.js'

export interface PrimeBacktrackDeps {
  currentSessionId: () => string
  setRewindPrimed: Dispatch<SetStateAction<boolean>>
  setRewindCount: Dispatch<SetStateAction<number>>
  setRewindNth: Dispatch<SetStateAction<number>>
  setRewindPreviews: Dispatch<SetStateAction<string[]>>
  setToast: Dispatch<SetStateAction<ToastPayload | null>>
}

export async function primeBacktrack(deps: PrimeBacktrackDeps): Promise<void> {
  // No initialiser: the `catch` toasts and returns, so the assignment below is the only way past.
  let previews: string[]
  try {
    previews = await readUserTurnPreviewsAsync(deps.currentSessionId())
  } catch {
    deps.setToast({ message: 'Backtrack unavailable: transcript unreadable', variant: 'info' })
    return
  }
  if (previews.length === 0) {
    const hint = legacyRootHint(0, join(homedir(), '.theokit'))
    deps.setToast({ message: hint ?? 'No previous message to edit', variant: 'info' })
    return
  }
  // B-029 — the data first, the flag LAST. `armed` is what makes the rest observable: the TUI
  // adapter builds its ladder inside `setRewindPrimed`, so raising the flag first captured a count
  // of 0 and an empty preview list — the state that existed when the flag went up, not the state it
  // was announcing. The overlay then drew nothing and the second Esc reset instead of stepping, so
  // Esc-rewind was dead.
  deps.setRewindCount(previews.length)
  deps.setRewindNth(SENTINEL)
  deps.setRewindPreviews(previews)
  deps.setRewindPrimed(true)
  deps.setToast({
    message: 'Esc again to edit a previous message · Enter to confirm',
    variant: 'info',
  })
}

export interface ConfirmBacktrackDeps {
  agent: { reset: () => void }
  setRotating: (v: boolean) => void
  stdout: { write: (s: string) => void } | undefined
  setToast: Dispatch<SetStateAction<ToastPayload | null>>
  setComposerSeed: Dispatch<SetStateAction<string>>
  setClearEpoch: Dispatch<SetStateAction<number>>
  resetBacktrack: () => void
  currentSessionId: () => string
  setSessionAndPersist: (id: string) => void
}

export async function confirmBacktrack(
  state: { rewindNth: number },
  deps: ConfirmBacktrackDeps,
): Promise<void> {
  const { rewindNth } = state
  const {
    agent,
    stdout,
    setToast,
    setComposerSeed,
    setClearEpoch,
    currentSessionId,
    setSessionAndPersist,
  } = deps
  if (rewindNth === SENTINEL) return
  const newId = `tui-${randomUUID()}`
  deps.setRotating(true)
  try {
    let out: ReturnType<typeof forkSessionBeforeUserTurn>
    try {
      out = await Promise.resolve().then(() =>
        forkSessionBeforeUserTurn(currentSessionId(), newId, rewindNth),
      )
    } catch (e) {
      setToast({ message: `Backtrack failed: ${(e as Error).message}`, variant: 'info' })
      deps.resetBacktrack()
      return
    }
    if (!out.copied) {
      setToast({ message: 'Backtrack: no transcript to fork', variant: 'info' })
      deps.resetBacktrack()
      return
    }
    try {
      setSessionAndPersist(newId)
      agent.reset()
      stdout?.write(CLEAR_SCREEN_AND_SCROLLBACK)
      setComposerSeed(out.selectedText ?? '')
      setClearEpoch((e) => e + 1)
    } catch (e) {
      // B-029 — these statements used to sit in a `try` with only a `finally`, and the caller
      // `void`s this promise, so a throw here became an unhandled rejection: under `node >=22` the
      // default is --unhandled-rejections=throw. The fork ALREADY happened at this point, so the
      // user must be told the session moved even though the surface did not fully follow.
      setToast({
        message: `Backtrack forked to ${newId} but the view did not update: ${(e as Error).message}`,
        variant: 'info',
      })
    }
    deps.resetBacktrack()
  } finally {
    deps.setRotating(false)
  }
  process.stderr.write(`[backtrack] forked ${newId} before user#${rewindNth}\n`)
}
