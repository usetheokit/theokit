import type { KeyAction } from './input-router.js'

export interface KeyCapabilities {
  readonly abandonQuestion: () => void
  readonly interruptTurn: () => void
  readonly goToChat: () => void
  readonly cancelDemo: () => void
  readonly closeDiff: () => void
  readonly closeUsage: () => void
  readonly closeHelp: () => void
  readonly pauseGoal: () => void
  readonly primeBacktrack: () => void
  readonly resetBacktrack: () => void
  readonly advanceBacktrack: (next: number, total: number) => void
  readonly confirmBacktrack: () => void
  readonly armExit: () => void
  readonly disarmExit: () => void
  readonly quit: () => void
  readonly toggleVerbose: () => void
}

const EXECUTORS: ReadonlyMap<KeyAction['kind'], (cap: KeyCapabilities, action: KeyAction) => void> =
  new Map([
    ['abandon-question', (c) => c.abandonQuestion()],
    ['interrupt-turn', (c) => c.interruptTurn()],
    ['close-progress', (c) => c.goToChat()],
    ['close-demo', (c) => c.cancelDemo()],
    ['close-diff', (c) => c.closeDiff()],
    ['close-usage', (c) => c.closeUsage()],
    ['close-help', (c) => c.closeHelp()],
    ['pause-goal', (c) => c.pauseGoal()],
    ['prime-backtrack', (c) => c.primeBacktrack()],
    ['reset-backtrack', (c) => c.resetBacktrack()],
    [
      'advance-backtrack',
      (c, action) => {
        if (action.kind === 'advance-backtrack') c.advanceBacktrack(action.next, action.total)
      },
    ],
    ['confirm-backtrack', (c) => c.confirmBacktrack()],
    ['arm-exit', (c) => c.armExit()],
    ['quit', (c) => c.quit()],
    ['disarm-exit', (c) => c.disarmExit()],
    ['toggle-verbose', (c) => c.toggleVerbose()],
  ])

export function applyKeyActions(actions: readonly KeyAction[], cap: KeyCapabilities): void {
  for (const action of actions) EXECUTORS.get(action.kind)?.(cap, action)
}
