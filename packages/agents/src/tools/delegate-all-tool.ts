// `createDelegateAllTool` — B-386: the agent starts several delegations in one call and reads every
// answer at once (OpenClaw's `agents_wait`, the "parallelizes" of Hermes row 5). Fan-out existed
// only app-side (`delegateBackground`, `Squad`); this is its agent-facing counterpart.
//
// It reuses `delegate`'s roster check and per-task outcome (`runDelegation`), so what a refusal
// tells the model is decided in one place for both tools.
import { Tool } from '@theokit/sdk'
import { z } from 'zod'

import {
  assertUsableRoster,
  DelegateToolConfigError,
  describeRoster,
  runDelegation,
  type CreateDelegateToolOptions,
  type DelegationOutcome,
} from './delegate-tool.js'

/** The bound on one call's tasks: enough to fan out, few enough that one call stays one turn. */
const MAX_TASKS = 4

export type CreateDelegateAllToolOptions = CreateDelegateToolOptions

/**
 * Build a tool that runs 1 to 4 delegations at once and answers after every one settled, in input
 * order. Every task starts before any is awaited. A task that is refused (budget, timeout, a failed
 * sub-agent) is reported as `{ ok: false, error, message }` beside the others; a defect in any task
 * is rethrown, but only once every task has settled, so no sub-agent is left running unobserved
 * (several defects together as one `AggregateError`). Each task runs with the same `defaults`, so a
 * `budget` there bounds each task, not the call: one call may spend up to four times it.
 */
export function createDelegateAllTool(options: CreateDelegateAllToolOptions) {
  const { roster, defaults, name = 'delegate_all', description } = options

  assertUsableRoster(roster, defaults, 'createDelegateAllTool')

  const byName = new Map(roster.map((entry) => [entry.name, entry.target]))
  const names = roster.map((entry) => entry.name) as [string, ...string[]]

  const inputSchema = z.object({
    tasks: z
      .array(
        z.object({
          agent: z
            .enum(names)
            .describe(`Which sub-agent runs the task. One of: ${describeRoster(roster)}.`),
          task: z
            .string()
            .min(1)
            .describe(
              'What the sub-agent should do, stated so it can be acted on without further context.',
            ),
        }),
      )
      .min(1)
      .max(MAX_TASKS)
      .describe(`1 to ${String(MAX_TASKS)} tasks, run at the same time.`),
  })

  return Tool.create({
    name,
    description:
      description ??
      `Run 1 to ${String(MAX_TASKS)} tasks at once on this app's sub-agents (${describeRoster(roster)}) and receive every answer together. ` +
        'Each sub-agent runs its own turn with its own token cost; reach for it when the work splits into independent parts. ' +
        'Returns JSON: { results: [{ agent, ok: true, response } | { agent, ok: false, error, message }] }, in the order given.',
    inputSchema,
    handler: async (raw: unknown): Promise<string> => {
      const { tasks } = inputSchema.parse(raw)

      // Every promise exists before the first await: the tasks run at once, not one after another.
      const pending = tasks.map(({ agent, task }) => {
        const target = byName.get(agent)
        // Unreachable by construction, as in `delegate`: the enum and the map come from one roster.
        if (target === undefined) {
          const unknown = new DelegateToolConfigError(
            `delegate_all: unknown agent ${JSON.stringify(agent)} — the roster holds ${describeRoster(roster)}.`,
            'unknown_agent',
          )
          return Promise.reject(unknown)
        }
        return runDelegation(target, task, defaults)
      })
      const settled = await Promise.allSettled(pending)

      const defects = settled.flatMap((outcome) =>
        outcome.status === 'rejected' ? [outcome.reason as unknown] : [],
      )
      if (defects.length === 1) throw defects[0]
      if (defects.length > 1) {
        throw new AggregateError(
          defects,
          `delegate_all: ${String(defects.length)} tasks failed with a defect`,
        )
      }

      const results = settled.map((outcome, index) => ({
        agent: tasks[index]?.agent,
        ...(outcome as PromiseFulfilledResult<DelegationOutcome>).value,
      }))
      return JSON.stringify({ results })
    },
  })
}
