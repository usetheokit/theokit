/**
 * agent-saas (M4) — the cohesive harness in one file.
 *
 * An `@Agent` with a HITL-gated `deploy` tool and `@Checkpoint`. Dropping this at `agents/ops.ts`
 * gives you `POST /api/agents/ops` with, at ZERO extra wiring:
 *
 *   • a HUMAN GATE — before `ops.deploy` runs, the stream emits a `tool-approval-request` and the
 *     run PAUSES (the SDK's own awaited `pre_tool_call` hook). A human approves via
 *     `POST /api/agents/ops/approve/<approvalId>`; on approve the tool runs, on deny/timeout the
 *     model gets the denial and the run continues.
 *   • RESUME — `@Checkpoint({ storage: 'filesystem' })` persists the conversation; a follow-up
 *     request with the same session id replays the prior turns (no re-run).
 *
 * @theokit/sdk stays the only runtime — this file is metadata the harness adapts (no LLM call,
 * no tool dispatch, no second loop lives here).
 */
import { Agent, MainLoop, Mixin, Toolbox, Tool, HumanInTheLoop, Checkpoint } from '@theokit/agents'
import { z } from 'zod'

@Toolbox({ namespace: 'ops' })
class OpsTools {
  @Tool({
    name: 'deploy',
    description: 'Deploy the given service to an environment.',
    input: z.object({ service: z.string(), env: z.enum(['staging', 'production']) }),
  })
  @HumanInTheLoop({
    question: 'Approve this production deploy?',
    timeout: 300_000,
    onTimeout: 'abort', // a timed-out approval is treated as a denial — never auto-deploy
  })
  async deploy(input: { service: string; env: string }): Promise<string> {
    return `Deployed ${input.service} to ${input.env}.`
  }
}

@Agent({
  name: 'ops',
  route: '/ops',
  model: 'claude-sonnet-4-6',
  systemPrompt:
    'You are an operations agent. Use the ops.deploy tool to ship services. Production deploys ' +
    'require human approval — surface the request and wait for the decision.',
})
@Checkpoint({ storage: 'filesystem', strategy: 'after-tool-call' })
@Mixin(OpsTools) // associate the toolbox — its @HumanInTheLoop tool becomes a gate on this agent
export default class OpsAgent {
  @MainLoop({ strategy: 'plan-act-reflect', maxIterations: 10 })
  async run(): Promise<void> {}
}

export { OpsTools }
