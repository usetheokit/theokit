import { ChannelTransport, type ChannelPushSource } from './channel-transport.js'
import { InProcessTransport, type InProcessRunner } from './in-process-transport.js'

/**
 * M47 (ADR-M47-2) — a typed, client-safe handle for an exposed agent.
 *
 * It carries ONLY the HTTP `path` at runtime plus phantom `input`/`toolNames` types (never populated) — so
 * `useAgent(chat)` / `createAgentClient(chat…)` bind with NO magic string (the path is generated from the
 * `@Expose` exposure, not hand-typed) and NO duplicated input type (the input type flows through the phantom
 * generic, inferred from the agent's `.input()`). This mirrors tRPC/Hono's type-only handle: the client
 * pulls the agent's TYPE via `import type`, never its server runtime. The generated `@theo/agents` module
 * emits one `export const <name> = agentHandle('/api/agents/<name>')` per agent, typed with the phantoms.
 */
export interface AgentHandle<TInput = unknown, TToolNames extends string = string> {
  /** The agent's HTTP endpoint path (e.g. `/api/agents/chat`). The only serializable/runtime-bearing field. */
  readonly path: string
  /**
   * M47 — bind this agent in-process (TUI / single-process): wraps the app's runner in an
   * {@link InProcessTransport}. `useAgent(chat.inProcess(run))` drives the SAME agent without HTTP.
   */
  inProcess(run: InProcessRunner): InProcessTransport
  /**
   * M47 — bind this agent over a push channel (Tauri desktop webview): wraps the source in a
   * {@link ChannelTransport}. `createAgentClient(chat.channel(source))` drives the SAME agent.
   */
  channel(source: ChannelPushSource): ChannelTransport
  /** Phantom — the agent's `input` type, carried for `useAgent(handle).send` inference. Never populated. */
  readonly __input?: TInput
  /** Phantom — the agent's tool-name union, carried end-to-end. Never populated. */
  readonly __toolNames?: TToolNames
}

/**
 * Build an {@link AgentHandle} from an agent's HTTP path. Types are supplied by the caller/codegen. The
 * `inProcess`/`channel` binders are methods (dropped by `JSON.stringify`, so the `{ path }` core stays
 * serializable + client-safe) that produce the M41 transports for the non-web surfaces.
 */
export function agentHandle<TInput = unknown, TToolNames extends string = string>(
  path: string,
): AgentHandle<TInput, TToolNames> {
  return {
    path,
    inProcess: (run) => new InProcessTransport({ run }),
    channel: (source) => new ChannelTransport({ source }),
  }
}

/** Narrow an unknown binding to an {@link AgentHandle} (has a string `path`, is not a transport). */
export function isAgentHandle(value: unknown): value is AgentHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { path?: unknown }).path === 'string' &&
    typeof (value as { sendMessages?: unknown }).sendMessages !== 'function'
  )
}
