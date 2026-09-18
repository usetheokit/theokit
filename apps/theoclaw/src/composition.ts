import 'reflect-metadata'

import { Container } from '@theokit/di'
import { createAgentProvider } from '@theokit/di-agent'

/**
 * The composition root — where concretes are wired into the container, and the only place that
 * happens (`rules/architecture.md` § 1: "Composition root is at the top… never deep inside
 * business code").
 *
 * **It exposes a request BOUNDARY rather than a resolve.** The container refuses a REQUEST-scoped
 * resolve outside one, with a typed error saying so:
 *
 *     ScopeViolationError: REQUEST scope requires container.runInRequest(...) to be active.
 *
 * That refusal is the reason this shape is what it is. A `resolveAgent()` that opened its own
 * boundary per call would make "one agent per request" mean "one agent per resolve", and two
 * collaborators serving the same inbound message would each get their own — which is the isolation
 * the scope exists to provide, inverted. The caller declares the request; everything resolved
 * inside it shares one agent.
 *
 * Decorators are deliberately absent. `@theokit/di-agent` publishes sixteen, and its own README
 * records — measured 2026-09-17 across every repository in the ecosystem — that fourteen are read
 * by nothing, anywhere; `@Workflow` and `@Step` are the two with a consumer, and that consumer
 * lives inside `di-agent` itself. A declaration this code carried would compile, record metadata,
 * and run nothing.
 */
export interface AgentCompositionOptions<TAgent> {
  /** How one agent is built. Called once per request boundary, never shared across two. */
  readonly factory: () => TAgent | Promise<TAgent>
}

export interface AgentComposition<TAgent> {
  /**
   * Run `work` inside one request. The agent it receives is that request's, and no other request
   * can observe it.
   */
  withAgent<R>(work: (agent: TAgent) => R | Promise<R>): Promise<R>
}

export function createContainer<TAgent>(
  options: AgentCompositionOptions<TAgent>,
): AgentComposition<TAgent> {
  const container = new Container()
  const provider = createAgentProvider<TAgent>({ factory: options.factory })

  container.register(provider)

  return {
    withAgent: (work) =>
      container.runInRequest(async () => work(await container.resolveAsync<TAgent>(provider.provide))),
  }
}
