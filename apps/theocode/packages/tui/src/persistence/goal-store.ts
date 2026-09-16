import { existsSync, readFileSync, rmSync } from 'node:fs'

import { atomicWriteText } from '@theokit/agents/persistence'
import { z } from 'zod'

import type { GoalRunState } from '../commands/index.js'
import { enqueue } from '../terminal-io/index.js'

const goalRunSchema = z.object({
  objective: z.string(),
  status: z.enum(['active', 'paused', 'completed', 'failed', 'budget_limited', 'blocked']),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  turns: z.number().optional(),
  tokens: z.number().optional(),
})

function doPersist(file: string, run: GoalRunState | null): Promise<void> {
  if (run === null) {
    try {
      rmSync(file, { force: true })
    } catch {
      // best-effort clear: if unlink fails (e.g. permission), the next persist overwrites it anyway —
      // the cleared state is not safety-critical, so we do not surface this to the TUI startup path.
    }
    return Promise.resolve()
  }
  return atomicWriteText(file, JSON.stringify(run))
}

export function persistGoalRun(file: string, run: GoalRunState | null): Promise<void> {
  return enqueue(file, () => doPersist(file, run))
}

export function loadGoalRun(file: string): GoalRunState | null {
  if (!existsSync(file)) return null
  try {
    const raw = readFileSync(file, 'utf8').trim()
    if (!raw) return null
    const parsed = goalRunSchema.safeParse(JSON.parse(raw))
    return parsed.success ? (parsed.data as GoalRunState) : null
  } catch {
    return null
  }
}
