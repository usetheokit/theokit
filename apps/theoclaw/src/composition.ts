import 'reflect-metadata'

import { isIPv6 } from 'node:net'

import { Container } from '@theokit/di'
import { createAgentProvider } from '@theokit/di-agent'

import { type ControlPlaneHandle, healthHandler, listenControlPlane } from './control-plane/listener.js'
import { readControlPlaneSettings } from './control-plane/settings.js'
import { installShutdown, type SignalSource } from './control-plane/shutdown.js'
import { createTurnRunner, type TurnAgent } from './control-plane/turn.js'

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

/** Everything the running process is made of, injected so the tests drive it without a process. */
export interface StartOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  /** Builds one agent per turn (one request boundary each). */
  readonly agentFactory: () => TurnAgent | Promise<TurnAgent>
  readonly stdout: (line: string) => void
  readonly stderr: (line: string) => void
  readonly signals: SignalSource
  readonly exit: (code: number) => void
  /** How the control plane listens. Default `listenControlPlane`; tests wrap it to count calls. */
  readonly listen?: typeof listenControlPlane
}

function formatAddress(address: { readonly host: string; readonly port: number }): string {
  return isIPv6(address.host) ? `[${address.host}]:${address.port}` : `${address.host}:${address.port}`
}

/**
 * Start TheoClaw's control plane: read and check the settings (a bad one throws before any socket
 * opens or agent exists), listen on the bound address, serve `/health` and, with a control token,
 * the `/control` socket, and close on the first SIGINT or SIGTERM. B-369 later passes its webhook
 * router as the listener's handler. The listening line is read from the socket (FR-012).
 */
export async function startTheoClaw(options: StartOptions): Promise<ControlPlaneHandle> {
  const settings = readControlPlaneSettings(options.env)
  const agents = createContainer<TurnAgent>({ factory: options.agentFactory })
  const listen = options.listen ?? listenControlPlane
  const handle = await listen({
    handler: healthHandler,
    port: settings.port,
    host: settings.host,
    stderr: options.stderr,
    ...(settings.controlToken === undefined
      ? {}
      : { control: { token: settings.controlToken, runTurn: createTurnRunner(agents.withAgent) } }),
  })
  installShutdown({ signals: options.signals, close: handle.close, exit: options.exit, stderr: options.stderr })
  options.stdout(`theoclaw: control plane listening on ${formatAddress(handle.address())}`)
  if (settings.controlToken === undefined) {
    options.stdout('theoclaw: control socket off (THEOCLAW_CONTROL_TOKEN unset)')
  }
  return handle
}
