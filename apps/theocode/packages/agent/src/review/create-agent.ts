import { Agent, buildModelSelection } from '@theokit/agents'
import type { CustomTool, HookHandlers } from '@theokit/agents'

import { hooksForMember } from '../delegation/index.js'
// B-084's back-compat re-export of `REVIEWER_TOOLS` is gone. Its own comment set the sunset —
// "delete once nothing outside this file reads it" — and the one reader was `composition.test.ts`,
// which now imports the name from `composition/agent-spec.ts`, where it is declared and where
// production reads it. A re-export whose only consumer is a test is surface the product does not
// have.
import { reviewerShape } from '../composition/agent-spec.js'

import type { AgentConfig } from '../config/index.js'
import { ToolRegistry, resolveToolScope, type ToolScope } from '../tools/index.js'
import { routeToCredential } from '../auth/model-route.js'
import type { ResolvedCredential } from '../auth/index.js'
import type { ReviewAgentLike, ReviewDeps } from './run-review.js'

export const REVIEWER_SHELL_CAP = 30_000

type ReviewerConfig = Pick<AgentConfig, 'model' | 'sandbox_mode'> &
  Partial<Pick<AgentConfig, 'reasoning_effort'>>

function reviewerScope(cfg: ReviewerConfig, cwd: string): ToolScope {
  return { ...resolveToolScope(cfg, cwd), defaultTimeoutMs: REVIEWER_SHELL_CAP }
}

interface AgentInstance {
  send(message: string): Promise<{ wait(): Promise<{ result?: string }> }>
  [Symbol.asyncDispose](): Promise<void>
}

export interface CreationOptions {
  agentId: string
  apiKey: string
  model: ReturnType<typeof buildModelSelection>
  local: { cwd: string }
  systemPrompt: string
  tools: CustomTool[]
  plugins?: Parameters<typeof Agent.create>[0]['plugins']
}

export interface ReviewFactoryDeps {
  config: ReviewerConfig
  cwd: string
  /**
   * #101 — the whole credential, not just its key.
   *
   * It was `(model) => Promise<string>`, and that shape is why `theocode review` failed for every
   * OAuth user: with only the key, this factory could not tell a ChatGPT credential from an API-key
   * one, so it could not route the model the way `run.ts` and `chat-transport.ts` both do. The model
   * reached a provider expecting `sk-…` and was refused, while the same model on the same
   * credential worked through `exec` and `resume`.
   */
  credential: (model: string) => Promise<ResolvedCredential>
  hooks?: HookHandlers
  registerCleanup: (fn: () => Promise<void>) => void
  createInstance?: (opts: CreationOptions) => Promise<AgentInstance>
  deleteAgent?: (agentId: string) => Promise<void>
}

const defaultCreateInstance = (opts: CreationOptions): Promise<AgentInstance> =>
  Agent.create(opts) as unknown as Promise<AgentInstance>

const defaultDeleteAgent = (agentId: string): Promise<void> =>
  Agent.delete(agentId).catch((err: unknown) => {
    process.stderr.write(`[review] Agent.delete(${agentId}) failed: ${String(err)}\n`)
  })

export function createReviewAgent(deps: ReviewFactoryDeps): ReviewDeps['createAgent'] {
  const createInstance = deps.createInstance ?? defaultCreateInstance
  const deleteAgent = deps.deleteAgent ?? defaultDeleteAgent
  const registry = new ToolRegistry(reviewerScope(deps.config, deps.cwd))
  // B-059 — the ONE composition entry. It returns the reviewer's SHAPE (a value); this factory
  // still creates the agent through the same `Agent.create` it always used, which is what keeps
  // this a declaration change and not a behaviour change.
  const shape = reviewerShape({
    registry,
    model: deps.config.model,
    reasoning_effort: deps.config.reasoning_effort ?? 'medium',
  })
  const hooksPlugin = deps.hooks !== undefined ? hooksForMember(deps.hooks) : undefined

  return async ({ agentId, systemPrompt }): Promise<ReviewAgentLike> => {
    const cred = await deps.credential(deps.config.model)
    // #101 — the same routing the chat path applies, at the same point: a ChatGPT credential serves
    // a differently-named model, and asking for the configured id would be asking the wrong
    // provider. `routeToCredential` is a no-op for an API-key credential, which the negative arm of
    // `create-agent.oauth.test.ts` pins — routing unconditionally would send a real `sk-` user to a
    // provider they never configured.
    const routed = routeToCredential(cred, deps.config.model)
    const inst = await createInstance({
      agentId,
      apiKey: cred.apiKey,
      model: buildModelSelection(routed, deps.config.reasoning_effort),
      local: { cwd: deps.cwd },
      systemPrompt,
      tools: [...shape.tools],
      ...(hooksPlugin !== undefined
        ? { plugins: [hooksPlugin] as unknown as Parameters<typeof Agent.create>[0]['plugins'] }
        : {}),
    })

    // B-043 — the flag is set AFTER the work, not before. Marking first meant a dispose that threw
    // left the reviewer permanently leaked: the guard said it had already been disposed, so no
    // retry and no cleanup could ever reach it again.
    let disposed = false
    const dispose = async (): Promise<void> => {
      if (disposed) return
      await inst[Symbol.asyncDispose]()
      await deleteAgent(agentId)
      disposed = true
    }
    deps.registerCleanup(dispose)

    return { send: (m: string) => inst.send(m), dispose: dispose }
  }
}
