/**
 * M2 (theokit-ai-first) — the file-convention runtime bridge.
 *
 * Turns a loaded `agents/<name>.ts` module into the M0/M1 canonical `UIMessageStream`:
 *
 *   module (defineAgent value | @Agent class) ──compileAgentModule──▶ CompiledAgentOptions
 *   CompiledAgentOptions ──createSdkAgentStream──▶ AgentStreamEvent* ──translate──▶ UIMessageChunk*
 *
 * Both agent surfaces converge here (ADR-B1): a `defineAgent` value lowers via
 * `compileAgentDefinition`, an `@Agent`-decorated class lowers via `compileAgent`
 * (which requires the full `@MainLoop` decoration — its existing errors surface for
 * DI-heavy classes). Neither runs an LLM directly — `@theokit/sdk` stays the sole
 * runtime (G2 / sdk-runtime.md); this module only wires its output onto the wire.
 */
import type { UIMessageChunk } from 'ai'

import { getAgentConfig } from '../decorators/agent.js'

import { compileAgent, type CompiledAgentOptions } from './agent-compiler.js'
import type { StreamEvent } from './agent-sse-handler.js'
import type { AgentStreamEvent } from './agent-stream-events.js'
import { compileAgentDefinition, isAgentDefinition } from './define-agent.js'
import { createSdkAgentStream } from './sdk-adapter.js'
import { translateToUIMessageStream } from './ui-message-stream-translator.js'
import { walkAgentMetadata } from './walk-agent-metadata.js'

/** Thrown when an `agents/` file default-exports neither a `defineAgent` value nor an `@Agent` class. */
export class AgentDefinitionError extends Error {
  constructor(source: string) {
    super(
      `[@theokit/agents] ${source}: an agents/ file must default-export a ` +
        `defineAgent(...) value or an @Agent-decorated class.`,
    )
    this.name = 'AgentDefinitionError'
  }
}

/** Unwrap a module namespace `{ default: X }` to `X`; pass a bare value through. */
function extractDefaultExport(mod: unknown): unknown {
  if (typeof mod === 'object' && mod !== null && 'default' in mod) {
    return mod.default
  }
  return mod
}

/**
 * Compile a loaded `agents/` module to SDK-ready options. Accepts a `defineAgent` value
 * (zero-config surface) OR an `@Agent`-decorated class (advanced surface). `source` labels
 * the fail-fast error (typically the file path).
 */
export function compileAgentModule(mod: unknown, source = 'agent module'): CompiledAgentOptions {
  const def = extractDefaultExport(mod)
  if (isAgentDefinition(def)) {
    return compileAgentDefinition(def)
  }
  if (typeof def === 'function' && getAgentConfig(def) !== undefined) {
    return compileAgent(walkAgentMetadata(def))
  }
  throw new AgentDefinitionError(source)
}

/**
 * Bridge the SDK stream (typed loosely as `StreamEvent`) to the strict `AgentStreamEvent`
 * union the translator consumes. `createSdkAgentStream` yields `AgentStreamEvent`-shaped
 * values (its `type` IS the union tag) — this is the single sanctioned narrowing boundary
 * (G3: via `unknown`); the translator ignores any variant it does not map.
 */
async function* asAgentStream(
  events: AsyncIterable<StreamEvent>,
): AsyncGenerator<AgentStreamEvent> {
  // The two unions do not structurally overlap (StreamEvent's index signature vs the
  // discriminated AgentStreamEvent), so tsc requires the `unknown` hop; this is the one
  // sanctioned narrowing point (the runtime values ARE AgentStreamEvents — same producer).
  for await (const e of events) yield e as unknown as AgentStreamEvent
}

/**
 * Run a compiled agent and yield the M0/M1 `UIMessageStream` chunks. `apiKey` is resolved
 * by the caller (`resolveProvider`). One `textId` per run (G8: `crypto.randomUUID`).
 */
export function streamAgentUIMessages(
  compiled: CompiledAgentOptions,
  apiKey: string,
  input: { message: string; sessionId: string },
): AsyncGenerator<UIMessageChunk> {
  const events = createSdkAgentStream(
    compiled,
    compiled.tools,
    apiKey,
  )(input.message, input.sessionId)
  return translateToUIMessageStream(asAgentStream(events), { textId: crypto.randomUUID() })
}
