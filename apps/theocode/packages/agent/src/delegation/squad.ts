import { homedir } from 'node:os'

import { type HookHandlers, type SDKAgent, Squad, Tool } from '@theokit/agents'
import { z } from 'zod'

import { type AgentConfig, type TrustPosture } from '../config/index.js'
import { resolveFreshCredential } from '../auth/index.js'
import { resolveToolScope } from '../tools/index.js'
import { buildRoleAgent, TEAM_ROLES, type RoleAgentContext } from './roles.js'
import { withDelegationCap } from './delegation-cap.js'

async function buildTeam(ctx: RoleAgentContext): Promise<{ squad: Squad; members: SDKAgent[] }> {
  const members = await Promise.all(TEAM_ROLES.map((role) => buildRoleAgent(role, ctx)))
  const squad = Squad.create({ agents: members, process: 'sequential', name: 'theocode-team' })
  return { squad, members }
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
}

/**
 * Dispose every team member, report the ones that failed, and never throw.
 *
 * B-043 — `allSettled`, not `all`. Called from a `finally`, a rejection REPLACES the value the try
 * block produced, so ONE member failing to dispose threw away the delegation result the user had
 * been waiting for. A cleanup failure is worth reporting and is not worth losing the work over.
 *
 * Extracted from the handler's `finally` so the guarantee can be tested. It was implemented, it was
 * explained in a comment, and it had no test — which is how B-043's third DoD bullet stayed both
 * vague and unprotected while the item read `shipped`. Found 2026-09-03 by the backlog structure
 * check flagging the bullet as unfalsifiable.
 */
export async function disposeMembers(
  members: readonly { [Symbol.asyncDispose]: () => PromiseLike<void> }[],
  report: (line: string) => void,
): Promise<void> {
  const disposals = await Promise.allSettled(members.map((m) => m[Symbol.asyncDispose]()))
  for (const d of disposals) {
    if (d.status === 'rejected') {
      report(`[delegation] a team member failed to dispose: ${String(d.reason)}\n`)
    }
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
      const { squad, members } = await buildTeam({
        apiKey: () =>
          resolveFreshCredential({ env: process.env, home: homedir() }).then((c) => c.apiKey),
        parent: { model: context.model, reasoning_effort: context.reasoning_effort },
        posture: context.posture,
        cwd: scope.cwd,
        sandbox: scope.sandbox,
        writeRoot: scope.writeRoot,
        ...(context.hooks !== undefined ? { hooks: context.hooks } : {}),
      })
      try {
        const run = await withDelegationCap(squad.run(task))
        return JSON.stringify({
          result: run.result,
          status: run.status,
          members: TEAM_ROLES,
          steps: run.steps.length,
        })
      } finally {
        await disposeMembers(members, (line) => process.stderr.write(line))
      }
    },
  })
}
