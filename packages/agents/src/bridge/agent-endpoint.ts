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
import { getMixins } from '../decorators/mixin.js'

import { compileAgent, type CompiledAgentOptions } from './agent-compiler.js'
import type { StreamEvent } from './agent-sse-handler.js'
import type { AgentStreamEvent } from './agent-stream-events.js'
import { compileAgentDefinition, isAgentDefinition } from './define-agent.js'
import { createHitlPlugin, type HitlWiring } from './hitl-plugin.js'
import { createSdkAgentStream, type RuntimeOverrides } from './sdk-adapter.js'
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
 *
 * For a class agent, its `@Mixin(...)` toolboxes are gathered (the declared tool-association
 * mechanism, same as `app.ts`/`theokit-plugin.ts`) and instantiated with a no-arg `new` — the
 * zero-config file convention has no DI container. This is what makes a `@HumanInTheLoop`-gated
 * tool on a mixin actually gate through the M2 endpoint (M4): its config reaches `compiled.hitl`.
 */
export function compileAgentModule(mod: unknown, source = 'agent module'): CompiledAgentOptions {
  const def = extractDefaultExport(mod)
  if (isAgentDefinition(def)) {
    return compileAgentDefinition(def)
  }
  if (typeof def === 'function' && getAgentConfig(def) !== undefined) {
    const walk = walkAgentMetadata(def, getMixins(def))
    const instances = new Map<Function, object>()
    for (const tb of walk.toolboxes) {
      instances.set(tb.class, new (tb.class as new () => object)())
    }
    return compileAgent(walk, instances)
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
 * A minimal single-consumer async queue for merging the SDK event stream with the HITL
 * plugin's out-of-band `approval_required` events (M4). Both the SDK-stream pump and the
 * plugin's `emit` push here; the translator drains it. When a gated tool pauses the SDK run
 * (the awaited `pre_tool_call` hook), the pump blocks with no SDK events — but the plugin's
 * approval event is already queued, so the client sees the approval request while paused.
 */
class EventQueue<T> {
  #items: T[] = []
  #resolvers: ((v: IteratorResult<T>) => void)[] = []
  #closed = false
  push(item: T): void {
    if (this.#closed) return
    const r = this.#resolvers.shift()
    if (r) r({ value: item, done: false })
    else this.#items.push(item)
  }
  close(): void {
    this.#closed = true
    for (const r of this.#resolvers.splice(0)) r({ value: undefined as never, done: true })
  }
  async *drain(): AsyncGenerator<T> {
    for (;;) {
      if (this.#items.length > 0) {
        yield this.#items.shift() as T
        continue
      }
      if (this.#closed) return
      const next = await new Promise<IteratorResult<T>>((resolve) => this.#resolvers.push(resolve))
      if (next.done) return
      yield next.value
    }
  }
}

/**
 * Append a `checkpoint_saved` event just before the terminal `done` (M4). The translator breaks on
 * `done`, so the checkpoint MUST precede it to reach the wire. `resumeToken` is the `sessionId` a
 * follow-up request replays through the SDK conversation storage. On a run that ends without a clean
 * `done` (e.g. error — the translator already broke), the trailing emit is inert. The SDK genuinely
 * persisted the turns via its conversation storage; this is the resume-handle signal, not a new store.
 */
async function* appendCheckpointSaved(
  source: AsyncGenerator<AgentStreamEvent>,
  sessionId: string,
): AsyncGenerator<AgentStreamEvent> {
  let emitted = false
  const checkpoint = (): AgentStreamEvent => ({
    type: 'checkpoint_saved',
    checkpointId: crypto.randomUUID(),
    step: 0,
    resumeToken: sessionId,
  })
  for await (const ev of source) {
    if (ev.type === 'done' && !emitted) {
      emitted = true
      yield checkpoint()
    }
    yield ev
  }
  if (!emitted) yield checkpoint()
}

/** HITL wiring supplied by the harness (mount-agent): the gated-tool map + the approval resolver. */
export interface StreamHitlOptions {
  gated: HitlWiring['gated']
  awaitApproval: HitlWiring['awaitApproval']
}

export interface StreamAgentOptions {
  message: string
  sessionId: string
  /** Enable human-in-the-loop tool approval (M4). Absent ⇒ the M2 non-HITL path, byte-unchanged. */
  hitl?: StreamHitlOptions
  /** Durable conversation storage for resume (M4); defaults to the SDK per-run in-memory store. */
  conversationStorage?: RuntimeOverrides['conversationStorage']
}

/**
 * Run a compiled agent and yield the M0/M1 `UIMessageStream` chunks. `apiKey` is resolved by the
 * caller (`resolveProvider`). One `textId` per run (G8: `crypto.randomUUID`). When `hitl` is
 * supplied (M4), a HITL `pre_tool_call` plugin pauses the run for gated tools — the pause is the
 * SDK's own awaited hook, never a second loop (ADR 0038).
 */
export function streamAgentUIMessages(
  compiled: CompiledAgentOptions,
  apiKey: string,
  input: StreamAgentOptions,
): AsyncGenerator<UIMessageChunk> {
  const textId = crypto.randomUUID()
  const overrides: RuntimeOverrides = {}
  if (input.conversationStorage) overrides.conversationStorage = input.conversationStorage

  let source: AsyncGenerator<AgentStreamEvent>
  if (!input.hitl || input.hitl.gated.size === 0) {
    // M2 non-HITL path — unchanged.
    const events = createSdkAgentStream(
      compiled,
      compiled.tools,
      apiKey,
      overrides,
    )(input.message, input.sessionId)
    source = asAgentStream(events)
  } else {
    // M4 HITL path — inject the plugin + merge its approval events with the SDK stream.
    const queue = new EventQueue<AgentStreamEvent>()
    const plugin = createHitlPlugin({
      gated: input.hitl.gated,
      emit: (e) => queue.push(e),
      awaitApproval: input.hitl.awaitApproval,
    })
    const sdkStream = createSdkAgentStream(compiled, compiled.tools, apiKey, {
      ...overrides,
      // The HITL plugin is a structural @theokit/sdk Plugin (createHitlPlugin returns the
      // { name, register } shape); the RuntimeOverrides.plugins union is widened at the SDK edge.
      plugins: [plugin] as unknown as RuntimeOverrides['plugins'],
    })(input.message, input.sessionId)
    // Pump the SDK stream into the shared queue; close when it ends.
    void (async () => {
      try {
        for await (const e of sdkStream) queue.push(e as unknown as AgentStreamEvent)
      } finally {
        queue.close()
      }
    })()
    source = queue.drain()
  }

  // M4 @Checkpoint: emit `checkpoint_saved` (→ `data-checkpoint`) when the agent declares it, so a
  // same-`sessionId` request resumes from the SDK-persisted history. Absent ⇒ no checkpoint chunk.
  const events = compiled.checkpoint ? appendCheckpointSaved(source, input.sessionId) : source
  return translateToUIMessageStream(events, { textId })
}
