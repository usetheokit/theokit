import { homedir } from 'node:os'

import { type HookHandlers, type SDKAgent, Squad, TheokitAgentError, Tool } from '@theokit/agents'
import type { BuiltinToolName } from '@theokit/sdk'
import { z } from 'zod'

import { type AgentConfig, type TrustPosture } from '../config/index.js'
import { resolveFreshCredential } from '../auth/index.js'
import { resolveToolScope } from '../tools/index.js'
import { buildRoleAgent, TEAM_ROLES, type RoleAgentContext } from './roles.js'

/**
 * The squad owns its members: it disposes them after every run, and a disposal failure reaches
 * `onDisposeError` without replacing the delegation's outcome (B-043).
 */
async function buildTeam(
  ctx: RoleAgentContext,
  report: (line: string) => void,
): Promise<{ squad: Squad }> {
  const members: SDKAgent[] = await Promise.all(TEAM_ROLES.map((role) => buildRoleAgent(role, ctx)))
  const squad = Squad.create({
    agents: members,
    process: 'sequential',
    name: 'theocode-team',
    ownsMembers: true,
    onDisposeError: (error, i) =>
      report(
        `[delegation] team member ${TEAM_ROLES[i] ?? String(i)} failed to dispose: ${String(error)}\n`,
      ),
  })
  return { squad }
}

export interface TeamContext {
  model: string
  reasoning_effort: AgentConfig['reasoning_effort']
  sandbox_mode: AgentConfig['sandbox_mode']
  posture: TrustPosture
  /**
   * B-032 — the directory the ROOT resolved, not `process.cwd()`.
   *
   * `resolveToolScope` derives BOTH the `writeRoot` and the sandbox `workDir` from this, so a team
   * built against the process directory confines its worker to a tree the caller did not choose.
   * B-015 gave `buildChatAgent` a single injected directory and this handler kept re-deriving one,
   * which made it the only bypass with a CONFINEMENT consequence rather than a configuration one.
   */
  cwd: string
  hooks?: HookHandlers
  /** What the parent withholds; every member withholds it too, with `shell`. */
  withheldBuiltinTools?: readonly BuiltinToolName[]
}

export const DELEGATION_CAP_MS = 15 * 60_000

/** Reported when the cap fires, with the recovery instruction TheoCode has always given. */
class DelegationExpiredError extends TheokitAgentError {
  override readonly name = 'DelegationExpiredError'

  constructor(capMs: number) {
    super(
      `[delegation_timeout] the delegation to delegate_to_team exceeded ${String(Math.round(capMs / 60_000))} min and was abandoned. ` +
        'The member agents were disposed of; work already written to disk was NOT reverted — ' +
        'inspect the tree before retrying.',
      { isRetryable: false, code: 'delegation_timeout' },
    )
  }
}

export function createDelegateToTeamTool(context: TeamContext) {
  return Tool.create({
    name: 'delegate_to_team',
    description:
      'Delegate a task to a SEQUENTIAL team of role agents (explorer → worker): the explorer reads the ' +
      'codebase read-only and its findings feed the worker, which makes the scoped change and reports it. ' +
      'This runs the members one after another (cost ≈ sum of both turns), NOT in parallel — reach for it ' +
      'only when an investigate-then-implement pipeline earns the extra tokens. Input: { task }.',
    inputSchema: z.object({
      task: z
        .string()
        .min(1)
        .describe('The task for the team (the explorer investigates it, the worker executes it).'),
    }),
    handler: async ({ task }: { task: string }) => {
      const scope = resolveToolScope({ sandbox_mode: context.sandbox_mode }, context.cwd)
      const { squad } = await buildTeam(
        {
          apiKey: () =>
            resolveFreshCredential({ env: process.env, home: homedir() }).then((c) => c.apiKey),
          parent: { model: context.model, reasoning_effort: context.reasoning_effort },
          posture: context.posture,
          cwd: scope.cwd,
          sandbox: scope.sandbox,
          writeRoot: scope.writeRoot,
          ...(context.hooks !== undefined ? { hooks: context.hooks } : {}),
          ...(context.withheldBuiltinTools !== undefined
            ? { withheldBuiltinTools: context.withheldBuiltinTools }
            : {}),
        },
        (line) => process.stderr.write(line),
      )
      // The cap cancels the member in flight by calling the member run's cancel() and resolves `timedOut`.
      const run = await squad.run(task, { timeoutMs: DELEGATION_CAP_MS })
      if (run.timedOut === true) throw new DelegationExpiredError(DELEGATION_CAP_MS)
      return JSON.stringify({
        result: run.result,
        status: run.status,
        members: TEAM_ROLES,
        steps: run.steps.length,
      })
    },
  })
}
