import { useEffect, useState } from 'react'

import { useTurnElapsed } from '@theokit/tui'

import type { GoalRunState } from '../commands/index.js'
import { loadGoalRun, persistGoalRun } from './goal-store.js'
import { fireAndForget } from './fire-and-forget.js'

export interface GoalRun {
  readonly goalRun: GoalRunState | null
  readonly setGoalRun: React.Dispatch<React.SetStateAction<GoalRunState | null>>
  readonly goalActive: boolean
  readonly goalBadge: string
}

export function useGoalRun(pointer: string): GoalRun {
  const [goalRun, setGoalRun] = useState<GoalRunState | null>(() => {
    const loaded = loadGoalRun(pointer)
    return loaded !== null && loaded.status === 'active' ? { ...loaded, status: 'paused' } : loaded
  })
  const goalActive = goalRun?.status === 'active'

  useEffect(() => {
    void fireAndForget(persistGoalRun(pointer, goalRun), 'the goal state')
  }, [pointer, goalRun])

  const goalElapsed = useTurnElapsed(goalActive)
  const goalBadge = goalLabel(goalRun, goalActive, goalElapsed)
  return { goalRun, setGoalRun, goalActive, goalBadge }
}

/**
 * The badge, WITHOUT a separator.
 *
 * It used to carry a leading ` · ` because the footer glued it straight onto the sandbox label.
 * Once the footer became a selection (`statusline-session.ts`) the separator became the footer's
 * job — the badge is one item among several, and an item that brings its own delimiter renders
 * ` ·  · goal:…` the moment the run is joined rather than concatenated.
 *
 * `''` when there is no run, which the footer reads as "omit": that is what keeps a selection
 * containing `goal` from leaving a dangling separator on the ninety-nine sessions with no goal.
 */
function goalLabel(goalRun: GoalRunState | null, goalActive: boolean, goalElapsed: number): string {
  if (goalRun === null) return ''
  if (goalActive) return `goal:pursuing (${String(goalElapsed)}s)`
  const total = Math.round(((goalRun.endedAt ?? Date.now()) - goalRun.startedAt) / 1000)
  return `goal:${goalRun.status} (${String(total)}s)`
}
