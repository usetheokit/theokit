import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import { useAgent } from '@theokit/agents/client/react'

import type { ResolvedCredential } from '@theocode/agent/auth'
import { resolveEffectiveConfig } from '@theocode/agent/config'
import type { ToastPayload } from '../screen-types.js'
import { workingDirectory } from '../working-directory.js'

export interface GoalRunState {
  objective: string
  status: 'active' | 'paused' | 'completed' | 'failed' | 'budget_limited' | 'blocked'
  startedAt: number
  endedAt?: number
  turns?: number
  tokens?: number
}

type TuiAgent = ReturnType<typeof useAgent<{ message: string }>>

export interface RunGoalDeps {
  agentRef: MutableRefObject<TuiAgent>
  goalAbort: MutableRefObject<AbortController | null>
  setGoalRun: Dispatch<SetStateAction<GoalRunState | null>>
  setGoalFeed: Dispatch<SetStateAction<string | null>>
  setToast: Dispatch<SetStateAction<ToastPayload | null>>
  credential: () => ResolvedCredential | { error: Error }
}

function openingWarnings(
  objective: string,
  cfg: { sandbox_mode: string; goal_oracle: string },
): string[] {
  const lines = [`▶ goal: ${objective}`]
  if (cfg.sandbox_mode === 'danger-full-access') {
    lines.push('⚠ danger-full-access: autonomous turns with NO kernel confinement')
  }
  if (cfg.goal_oracle === 'update_goal') {
    lines.push('⚠ goal_oracle=update_goal applies to `exec goal` only; the TUI uses the judge')
  }
  return lines
}

function shutdownRun(
  carried: { turns: number; tokens: number; startedAt: number },
  final: { status: GoalRunState['status']; turnsUsed: number; tokensUsed: number } | null,
): (g: GoalRunState | null) => GoalRunState | null {
  return (g) =>
    g === null
      ? null
      : {
          ...g,
          status: final?.status ?? 'failed',
          endedAt: Date.now(),
          turns: carried.turns + (final?.turnsUsed ?? 0),
          tokens: carried.tokens + (final?.tokensUsed ?? 0),
        }
}

type RaceOutcome = {
  status: GoalRunState['status']
  turnsUsed: number
  tokensUsed: number
} | null

async function driveGoal(
  objective: string,
  carried: { turns: number; tokens: number; startedAt: number },
  controller: AbortController,
  deps: RunGoalDeps,
): Promise<RaceOutcome> {
  const { agentRef, setGoalFeed, setToast, credential } = deps
  const { GOAL_DEFAULTS, routeGoalModel, runGoal } = await import('@theocode/agent/goal')
  const { createStoreGoalAgent } = await import('./goal-store-agent.js')
  const cfg = resolveEffectiveConfig({ cwd: workingDirectory() })
  const cred = credential()
  if ('error' in cred) throw cred.error
  const storeAgent = createStoreGoalAgent({
    send: (t) => agentRef.current.send({ message: t }),
    snapshot: () => agentRef.current,
  })
  const lines = openingWarnings(objective, cfg)
  setGoalFeed(lines.join('\n'))
  const remainingBudget = Math.max(0, GOAL_DEFAULTS.tokenBudget - carried.tokens)
  const remainingTurns = Math.max(0, GOAL_DEFAULTS.maxTurns - carried.turns)
  if (remainingBudget === 0 || remainingTurns === 0) {
    setToast({
      message: 'Goal budget exhausted — /goal clear, then set a new one',
      variant: 'info',
    })
    return { status: 'budget_limited', turnsUsed: 0, tokensUsed: 0 }
  }
  const result = await runGoal(
    storeAgent as never,
    objective,
    {
      maxTurns: remainingTurns,
      tokenBudget: remainingBudget,
      judgeApiKey: cred.apiKey,
      agentModel: routeGoalModel(cred, cfg.model),
      signal: controller.signal,
    },
    {
      onLine: (l) => {
        lines.push(l)
        setGoalFeed(lines.join('\n'))
      },
    },
  )
  const cumTurns = carried.turns + result.turnsUsed
  const cumTokens = carried.tokens + result.tokensUsed
  process.stderr.write(
    `[goal] status=${result.status} turns=${String(cumTurns)} tokens=${String(cumTokens)}\n`,
  )
  setToast({
    message: `<< goal ${result.status}: ${String(cumTurns)} turn(s), ${String(cumTokens)} tokens >>`,
    variant: result.status === 'completed' ? 'success' : 'info',
  })
  return result
}

export function runGoalLoop(
  objective: string,
  base: { turns: number; tokens: number; startedAt: number } | undefined,
  deps: RunGoalDeps,
): void {
  const { agentRef, goalAbort, setGoalRun, setToast } = deps
  if (agentRef.current.status === 'streaming') {
    setToast({
      message: 'Wait for the current turn to finish before starting the goal',
      variant: 'info',
    })
    return
  }
  const controller = new AbortController()
  goalAbort.current = controller
  const carried = base ?? { turns: 0, tokens: 0, startedAt: Date.now() }
  setGoalRun({
    objective,
    status: 'active',
    startedAt: carried.startedAt,
    turns: carried.turns,
    tokens: carried.tokens,
  })
  deps.setGoalFeed(`▶ goal: ${objective}`)
  void (async () => {
    let final: RaceOutcome = null
    try {
      final = await driveGoal(objective, carried, controller, deps)
    } catch (err) {
      setToast({
        message: `/goal failed: ${err instanceof Error ? err.message : String(err)}`,
        variant: 'error',
      })
    } finally {
      goalAbort.current = null
      setGoalRun(shutdownRun(carried, final))
    }
  })()
}

export interface GoalVerbDeps {
  goalAbort: MutableRefObject<AbortController | null>
  agent: { abort: () => void }
  setGoalRun: Dispatch<SetStateAction<GoalRunState | null>>
  setGoalFeed: Dispatch<SetStateAction<string | null>>
  setToast: Dispatch<SetStateAction<ToastPayload | null>>
  setComposerSeed: Dispatch<SetStateAction<string>>
  setClearEpoch: Dispatch<SetStateAction<number>>
  startGoal: (
    objective: string,
    base?: { turns: number; tokens: number; startedAt: number },
  ) => void
}

interface VerbContext {
  readonly state: { goalRun: GoalRunState | null; goalActive: boolean }
  readonly deps: GoalVerbDeps
}

function verbStatus({ state, deps }: VerbContext): void {
  const { goalRun } = state
  if (goalRun === null) {
    deps.setToast({
      message: 'Usage: /goal [<objective>|pause|resume|edit|clear] — no goal is active',
      variant: 'info',
    })
    return
  }
  const dur = Math.round(((goalRun.endedAt ?? Date.now()) - goalRun.startedAt) / 1000)
  const turns = goalRun.turns !== undefined ? `, ${String(goalRun.turns)} turn(s)` : ''
  const tokens = goalRun.tokens !== undefined ? `, ${String(goalRun.tokens)} tokens` : ''
  deps.setToast({
    message: `goal ${goalRun.status} (${String(dur)}s${turns}${tokens}): ${goalRun.objective.slice(0, 80)}`,
    variant: 'info',
  })
}

function verbPause({ state, deps }: VerbContext): void {
  if (!state.goalActive) {
    deps.setToast({ message: 'No active goal to pause', variant: 'info' })
    return
  }
  deps.goalAbort.current?.abort()
  deps.agent.abort()
  deps.setToast({ message: 'Goal pausing… (resume with /goal resume)', variant: 'info' })
}

function verbClear({ state, deps }: VerbContext): void {
  if (state.goalActive) {
    deps.goalAbort.current?.abort()
    deps.agent.abort()
  }
  deps.setGoalRun(null)
  deps.setGoalFeed(null)
  deps.setToast({ message: 'Goal cleared', variant: 'info' })
}

function verbEdit({ state, deps }: VerbContext): void {
  const { goalRun, goalActive } = state
  if (goalRun === null) {
    deps.setToast({ message: 'No goal to edit', variant: 'info' })
    return
  }
  if (goalActive) {
    deps.setToast({ message: 'Pause the goal before editing (/goal pause)', variant: 'info' })
    return
  }
  deps.setComposerSeed(`/goal ${goalRun.objective}`)
  deps.setClearEpoch((e) => e + 1)
}

function verbResume({ state, deps }: VerbContext): void {
  const { goalRun, goalActive } = state
  if (goalRun === null) {
    deps.setToast({ message: 'No goal to resume', variant: 'info' })
    return
  }
  if (goalActive) {
    deps.setToast({ message: 'The goal is already active', variant: 'info' })
    return
  }
  deps.startGoal(goalRun.objective, {
    turns: goalRun.turns ?? 0,
    tokens: goalRun.tokens ?? 0,
    startedAt: goalRun.startedAt,
  })
}

const GOAL_VERBS: ReadonlyMap<string, (ctx: VerbContext) => void> = new Map([
  ['', verbStatus],
  ['pause', verbPause],
  ['clear', verbClear],
  ['edit', verbEdit],
  ['resume', verbResume],
])

export function handleGoalVerb(
  arg0: string,
  state: { goalRun: GoalRunState | null; goalActive: boolean },
  deps: GoalVerbDeps,
): void {
  const arg = arg0.trim()
  const verb = GOAL_VERBS.get(arg)
  if (verb !== undefined) {
    verb({ state, deps })
    return
  }
  if (state.goalActive) {
    deps.setToast({
      message: 'A goal is already running (Esc, or /goal pause, to interrupt it)',
      variant: 'info',
    })
    return
  }
  deps.startGoal(arg)
}
