import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import type { CommandCapabilities } from './command-capabilities.js'
import { interpretCommand } from './interpret-command.js'
import { noteTurnStart } from '../persistence/fork-session.js'
import { routeCommand } from './registry.js'
import { runGoalLoop, type GoalRunState } from './goal.js'

export interface ComposerDeps extends Omit<CommandCapabilities, 'startGoal'> {
  readonly agentRef: Parameters<typeof runGoalLoop>[2]['agentRef']
  readonly credential: Parameters<typeof runGoalLoop>[2]['credential']
  readonly customCommandNames: ReadonlySet<string>
  readonly goalFeed: string | null
  readonly reviewResult: string | null
  readonly setGoalRun: Dispatch<SetStateAction<GoalRunState | null>>
  readonly goalAbort: MutableRefObject<AbortController | null>
}

export interface ComposerCommands {
  readonly handleSubmit: (text: string) => void
}

const TURN_STARTING: ReadonlySet<string> = new Set(['send', 'retry', 'custom', 'initAgents'])

export function useComposerCommands(deps: ComposerDeps): ComposerCommands {
  const startGoal: CommandCapabilities['startGoal'] = (objective, base) => {
    // Goal turns skip handleSubmit and set up asynchronously: record the start before that begins.
    // A goal refused because a turn is streaming starts nothing, so it must not stale a fork.
    if (deps.agentRef.current.status !== 'streaming') noteTurnStart()
    runGoalLoop(objective, base, {
      agentRef: deps.agentRef,
      goalAbort: deps.goalAbort,
      setGoalRun: deps.setGoalRun,
      setGoalFeed: deps.setGoalFeed,
      setToast: deps.setToast,
      credential: deps.credential,
    })
  }

  const handleSubmit = (text: string): void => {
    if (deps.reviewResult !== null) deps.setReviewResult(null)
    if (deps.goalFeed !== null && !deps.goalActive) deps.setGoalFeed(null)

    const action = routeCommand(text, deps.customCommandNames)
    if (
      deps.goalActive &&
      (action.kind === 'send' || action.kind === 'retry' || action.kind === 'custom')
    ) {
      deps.setToast({
        message: 'A goal is running — wait, pause it (Esc), or /goal clear, before sending',
        variant: 'info',
      })
      return
    }
    // Only commands that actually start a turn invalidate a fork still copying; session changes
    // (/new, /resume) are caught by the session id comparison.
    if (TURN_STARTING.has(action.kind)) noteTurnStart()
    // `/fork` is async; handleFork reports its own failures, this only keeps a stray rejection
    // from becoming an unhandled one.
    void Promise.resolve(interpretCommand(action, text, { ...deps, startGoal })).catch(
      (e: unknown) => {
        deps.setToast({ message: `Command failed: ${(e as Error).message}`, variant: 'error' })
      },
    )
  }

  return { handleSubmit }
}
