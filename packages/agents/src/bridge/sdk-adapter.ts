/**
 * SDK Adapter — bridges @theokit/agents decorators → @theokit/sdk runtime.
 *
 * Per rule sdk-runtime.md (INQUEBRÁVEL): @theokit/sdk is the ONLY agent runtime.
 * This adapter replaces llm-runner.ts (which called OpenRouter API directly).
 *
 * Flow: @Agent decorator → compileAgent() → createSdkAgentStream() → SDK Agent.create() → Run.stream()
 */
import type {
  AgentDefinition,
  BudgetTracker,
  ConversationStorageAdapter,
  CustomTool,
  InlineSkill,
  InteractionUpdate,
  Plugin,
  PluginsSettings,
  ProviderRoutingSettings,
  SendOptions,
} from '@theokit/sdk'

import { debugLog } from '../debug-log.js'
import type { ReasoningEffort } from '../types.js'

import type { CompiledAgentOptions, CompiledTool } from './agent-compiler.js'
import type { StreamEvent } from './agent-sse-handler.js'
import {
  translateInteractionUpdate,
  translateSdkEvent,
  type SdkMessage,
} from './event-translator.js'
import { buildModelSelection } from './model-selection.js'
import { assembleM8CreateOptions, realUsageDone } from './sdk-adapter-create-options.js'
import { extractThinkTagStream } from './think-tag-extractor.js'
import { stripToolDialectStream } from './tool-dialect-stripper.js'

/**
 * Per-request overrides forwarded into `Agent.create` (V4-L.2 + V4-L.3). Bundled into
 * one object (rather than positional params) so the per-request surface can grow without
 * a parameter explosion. Each field is Axis-A SWAP — a value the app holds at call time.
 */
export interface RuntimeOverrides {
  /** Overrides the model for this call (`?? compiled.model ?? default`). */
  model?: string
  /**
   * Per-run extended-thinking effort (`?? compiled.reasoningEffort`). Mapped to the SDK
   * `ModelSelection.params` so the provider produces reasoning (surfaced as `thinking` StreamEvents).
   */
  reasoningEffort?: ReasoningEffort
  /**
   * Per-run opt-in (`?? compiled.parseThinkTags`): when true, wrap the event stream with the M2
   * `<think>`-tag extractor so inline `<think>…</think>` text becomes `thinking` StreamEvents.
   */
  parseThinkTags?: boolean
  /**
   * Per-run opt-in (`?? compiled.stripToolDialect`): when true, strip a leaked Hermes
   * `<function=…></tool_call>` tool-call dialect out of the assistant text stream (theocode#32).
   */
  stripToolDialect?: boolean
  /**
   * Per-run opt-in (`?? compiled.recoverLeakedToolCalls`): when true, enable the SDK chat route's
   * `extractToolCallsFromContent` so a leaked Hermes `<function=…></tool_call>` dialect is recovered
   * and EXECUTED (theokit#58). Sibling of {@link stripToolDialect}; has effect only when {@link providers}
   * routes a provider.
   */
  recoverLeakedToolCalls?: boolean
  /** Per-run cwd → `Agent.create({ local: { cwd } })` → `SystemPromptContext.cwd`. */
  cwd?: string
  /**
   * M7 — per-run run-context override (`?? compiled.runContext`). Injected into every tool
   * handler's `ctx.context` by `buildSdkTools`. Lets a single request override the agent-level
   * `defineAgent({ context })` (mirrors `model`/`cwd`).
   */
  runContext?: Record<string, unknown>
  /**
   * Per-run plugins (e.g. permission gate selected by request mode). Accepts EITHER
   * named-plugin discovery settings (`{ enabled: [...] }`) OR an array of code `Plugin`
   * objects, forwarded RAW through the duck-typed `Agent.create` bridge (mirrors the
   * @theokit/sdk `AgentOptions.plugins` widen).
   */
  plugins?: PluginsSettings | readonly Plugin[]
  /** Per-run provider routing. */
  providers?: ProviderRoutingSettings
  /** Per-run sub-agent definitions (opts-only; `compiled.agents` stays deferred — ADR D3). */
  agents?: Record<string, AgentDefinition>
  /** Per-run SDK budget tracker (inner tool-loop cap; distinct from the loop's USD `budget`). */
  budgetTracker?: BudgetTracker
  /**
   * V4-M: conversation store shared across the loop's rounds so history persists
   * (round N+1 sees rounds 1..N). Default `InMemoryConversationStorage` (per-run,
   * no disk). Pass a `FileSystemConversationStorage`/custom adapter for durable history.
   */
  conversationStorage?: ConversationStorageAdapter
  /**
   * V4-Q: pre-built SDK `CustomTool[]` forwarded RAW to `Agent.create.tools` (appended after the
   * compiled tools), bypassing `defineTool` (which requires a Zod schema). Lets an app whose tools
   * come from imperative SDK factories supply them without the `@Tool` compile path.
   */
  sdkTools?: readonly CustomTool[]
}

/**
 * theokit#58: clone provider routing with `extractToolCallsFromContent` enabled on every route, so the
 * SDK recovers a leaked Hermes `<function=…></tool_call>` dialect that would otherwise be lost. The SDK
 * reads the flag off the chat route (routes[0]); marking all routes is fail-open — a non-leaking route
 * is unaffected (recovery only fires on a finish with ZERO native tool_calls carrying the dialect).
 */
function withLeakedDialectRecovery(providers: ProviderRoutingSettings): ProviderRoutingSettings {
  return {
    ...providers,
    routes: providers.routes.map((route) => ({ ...route, extractToolCallsFromContent: true })),
  }
}

/**
 * Project the V4-L.3 per-request fields into the `Agent.create` extra surface (absent ⇒ no
 * key). Extracted from the stream generator to keep its cyclomatic complexity within budget (G6).
 * theokit#58: per-run `recoverLeakedToolCalls` (overrides compiled) opts the routed provider into
 * SDK leaked-dialect recovery by cloning the routes with `extractToolCallsFromContent`.
 */
function buildExtraCreateOptions(
  overrides: RuntimeOverrides,
  compiled: CompiledAgentOptions,
): Record<string, unknown> {
  const recoverLeakedToolCalls =
    overrides.recoverLeakedToolCalls ?? compiled.recoverLeakedToolCalls ?? false
  const extra: Record<string, unknown> = {}
  if (overrides.plugins !== undefined) extra.plugins = overrides.plugins
  if (overrides.providers !== undefined) {
    extra.providers = recoverLeakedToolCalls
      ? withLeakedDialectRecovery(overrides.providers)
      : overrides.providers
  }
  if (overrides.agents !== undefined) extra.agents = overrides.agents
  if (overrides.budgetTracker !== undefined) extra.budgetTracker = overrides.budgetTracker
  return extra
}

/** The `@theokit/sdk` `Agent` surface the adapter drives (dynamic-import shape, kept minimal). */
interface SdkAgentApi {
  getOrCreate: (
    id: string,
    opts: Record<string, unknown>,
  ) => Promise<{
    // #40: the SDK token-streams ONLY via send's onDelta callback (proven empirically);
    // run.stream() yields complete messages. The adapter merges both.
    send: (
      msg: string,
      // onDelta receives `{ update: InteractionUpdate }`; toolChoice gates tools for this send.
      opts?: {
        onDelta?: (d: { update: InteractionUpdate }) => void
        toolChoice?: 'auto' | 'none' | 'required'
      },
    ) => Promise<{
      stream: () => AsyncGenerator<SdkMessage>
      // V4-N.1: the SDK Run's terminal await — carries the real per-run token usage + cost.
      // V4-O: usage also carries optional reasoning/cache buckets (forwarded by realUsageDone).
      wait: () => Promise<{
        result?: string
        usage?: {
          inputTokens?: number
          outputTokens?: number
          reasoningTokens?: number
          cacheReadTokens?: number
          cacheWriteTokens?: number
        }
        cost?: { amount?: number }
      }>
    }>
    dispose: () => Promise<void>
  }>
}

/** The resolved `@theokit/sdk` runtime symbols the adapter needs, bound after the dynamic import. */
interface SdkRuntime {
  Agent: SdkAgentApi
  defineTool: (spec: {
    name: string
    description: string
    inputSchema: unknown
    handler: (input: unknown) => string | Promise<string>
  }) => unknown
  InMemoryConversationStorage: new () => ConversationStorageAdapter
  FileSystemConversationStorage: new () => ConversationStorageAdapter
  /**
   * SE23 — optional `skill_read` tool factory. Absent on SDKs older than it shipped; guarded with `in`
   * at load so an older peer degrades gracefully (inline skills still list in the `<skills>` block, they
   * just aren't auto-readable). Used to auto-wire reading for `defineAgent({ skills: [inlineSkill] })`.
   */
  defineSkillReadTool?: (skills: readonly InlineSkill[]) => unknown
}

/**
 * Dynamically import `@theokit/sdk` (optional peer dep) and bind the runtime symbols; `null` when it
 * is not installed (the caller emits `SDK_NOT_INSTALLED`). FS storage is guarded with `in` so an SDK
 * build (or a test mock) that omits the export does not throw the whole import — it falls back to
 * in-memory (no durable resume). Only used for `@Checkpoint({ storage: 'filesystem' })`.
 */
async function loadSdkRuntime(): Promise<SdkRuntime | null> {
  try {
    const sdk = await import('@theokit/sdk')
    const InMemory = sdk.InMemoryConversationStorage
    return {
      Agent: sdk.Agent as unknown as SdkAgentApi,
      defineTool: sdk.defineTool as unknown as SdkRuntime['defineTool'],
      InMemoryConversationStorage: InMemory,
      FileSystemConversationStorage:
        'FileSystemConversationStorage' in sdk ? sdk.FileSystemConversationStorage : InMemory,
      ...('defineSkillReadTool' in sdk
        ? { defineSkillReadTool: sdk.defineSkillReadTool as SdkRuntime['defineSkillReadTool'] }
        : {}),
    }
  } catch (err) {
    console.warn('[theokit] @theokit/sdk import failed:', err)
    return null
  }
}

/**
 * Pick the shared conversation store (M4). `@Checkpoint({ storage: 'filesystem' })` selects the
 * SDK's durable FS adapter so a same-`sessionId` follow-up request RESUMES from persisted history
 * (no new store — the SDK owns persistence). Everything else keeps the per-run in-memory store
 * ('drizzle'/'redis' are not shipped by the SDK → in-memory fallback).
 */
function newConversationStorage(
  compiled: CompiledAgentOptions,
  InMemory: new () => ConversationStorageAdapter,
  FileSystem: new () => ConversationStorageAdapter,
): ConversationStorageAdapter {
  return compiled.checkpoint?.storage === 'filesystem' ? new FileSystem() : new InMemory()
}

/** #40: tagged item flowing through the merge queue — an incremental delta or a complete SDK message. */
type MergeItem = { kind: 'delta'; event: StreamEvent } | { kind: 'sdk'; msg: SdkMessage }

/** Minimal single-producer/single-consumer async queue (#40 — merge onDelta tokens with run.stream()). */
interface AsyncQueue<T> {
  push: (item: T) => void
  close: () => void
  [Symbol.asyncIterator]: () => AsyncIterator<T>
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const items: T[] = []
  let wake: (() => void) | null = null
  let closed = false
  return {
    push(item: T) {
      items.push(item)
      if (wake) {
        wake()
        wake = null
      }
    },
    close() {
      closed = true
      if (wake) {
        wake()
        wake = null
      }
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (items.length > 0) {
          const next = items.shift()
          if (next !== undefined) yield next
        }
        if (closed) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
}

/**
 * #44 dedup state — text/thinking by category flag (no per-event id); tool by callId Set, so a
 * `run.stream()` tool result whose callId onDelta only reported as `tool-call-started` (e.g. a tool
 * ERROR surfaced only via the stream) is NOT suppressed. `sawError` short-circuits the real-usage done.
 */
interface MergeState {
  sawTextDelta: boolean
  sawThinkingDelta: boolean
  emittedToolCallIds: Set<string>
  emittedToolResultIds: Set<string>
  sawError: boolean
}

/** Read a StreamEvent's `callId` as a string (the union is index-typed `unknown`). */
function streamCallId(ev: StreamEvent): string {
  return typeof ev.callId === 'string' ? ev.callId : ''
}

/**
 * #44 — skip a run.stream() content event ONLY when onDelta already drove that exact (category, id).
 * Tool dedup is keyed by callId; an empty/missing callId never matches (returns false) so two distinct
 * id-less tool events cannot collide and wrongly suppress each other (favours a visible double-emit
 * over silent loss — fail-loud).
 */
function isDuplicatedByDelta(ev: StreamEvent, state: MergeState): boolean {
  if (ev.type === 'text_delta') return state.sawTextDelta
  if (ev.type === 'thinking') return state.sawThinkingDelta
  if (ev.type === 'tool_call') {
    const id = streamCallId(ev)
    return id !== '' && state.emittedToolCallIds.has(id)
  }
  if (ev.type === 'tool_result') {
    const id = streamCallId(ev)
    return id !== '' && state.emittedToolResultIds.has(id)
  }
  return false
}

/**
 * #44: merge real-time content events (queued via onDelta — text/tool/thinking in chronological
 * arrival order) with the complete SDK messages from `run.stream()`. Deltas are yielded as they
 * arrive; the pump opens `run.stream()` (post-completion) for structural events (`run_started`/`done`)
 * + the no-onDelta fallback, deduped per-category (`isDuplicatedByDelta`) so nothing double-emits.
 * The `done` SDK event stays suppressed (real-usage `done` emitted by the caller after `run.wait()`);
 * errors set `state.sawError`. `openStream` is a thunk so the consumer drains CONCURRENTLY with
 * `send()` (the run only resolves after the loop completes). Extracted to keep the generator within G6.
 */
async function* mergeDeltaStream(
  queue: AsyncQueue<MergeItem>,
  openStream: () => Promise<AsyncGenerator<SdkMessage>>,
  runId: string,
  state: MergeState,
): AsyncGenerator<StreamEvent> {
  // The catch is attached AT CREATION (not deferred to `await pump`): the consumer loop below is
  // paced by the external puller (SSE backpressure), so a send()/stream() rejection could otherwise
  // sit unhandled across macrotask gaps and crash the process (Node unhandledRejection). The captured
  // error is re-thrown after the drain so it still surfaces in the caller's try/catch as one error event.
  let pumpError: { thrown: unknown } | undefined
  const pump = (async () => {
    try {
      const stream = await openStream()
      for await (const msg of stream) queue.push({ kind: 'sdk', msg })
    } finally {
      queue.close()
    }
  })().catch((thrown: unknown) => {
    pumpError = { thrown }
  })
  for await (const item of queue) {
    if (item.kind === 'delta') {
      yield item.event
      continue
    }
    for (const out of translateSdkEvent(item.msg, runId)) {
      if (out.type === 'done') continue // suppressed; the real-usage done is emitted by the caller
      if (isDuplicatedByDelta(out, state)) continue // #44 per-category/callId dedup vs onDelta
      if (out.type === 'error') state.sawError = true
      yield out
    }
  }
  await pump // settled (handled at creation); re-throw any captured error into the generator's try/catch
  if (pumpError) throw pumpError.thrown
}

/**
 * #44 — build the onDelta sink: a fresh per-run dedup `MergeState` + the callback that routes every
 * content update (text/tool/thinking) into the merge queue in chronological arrival order, recording
 * per-category flags + per-callId Sets so the run.stream() fallback is deduped without losing
 * stream-only tool results. Extracted to keep `createSdkAgentStream` within the function-size budget.
 */
function createDeltaSink(queue: AsyncQueue<MergeItem>): {
  state: MergeState
  onDelta: (d: { update: InteractionUpdate }) => void
} {
  const state: MergeState = {
    sawTextDelta: false,
    sawThinkingDelta: false,
    emittedToolCallIds: new Set<string>(),
    emittedToolResultIds: new Set<string>(),
    sawError: false,
  }
  const onDelta = (d: { update: InteractionUpdate }) => {
    for (const event of translateInteractionUpdate(d.update)) {
      if (event.type === 'text_delta') state.sawTextDelta = true
      else if (event.type === 'thinking') state.sawThinkingDelta = true
      else if (event.type === 'tool_call') {
        const id = streamCallId(event)
        if (id !== '') state.emittedToolCallIds.add(id)
      } else if (event.type === 'tool_result') {
        const id = streamCallId(event)
        if (id !== '') state.emittedToolResultIds.add(id)
      }
      queue.push({ kind: 'delta', event })
    }
  }
  return { state, onDelta }
}

/**
 * Resolve the per-run opt-in text-transform flags, each `override ?? compiled ?? false` (mirrors `model`).
 */
function resolveTextTransformFlags(
  compiled: CompiledAgentOptions,
  overrides: RuntimeOverrides,
): { parseThinkTags: boolean; stripToolDialect: boolean } {
  return {
    parseThinkTags: overrides.parseThinkTags ?? compiled.parseThinkTags ?? false,
    stripToolDialect: overrides.stripToolDialect ?? compiled.stripToolDialect ?? false,
  }
}

/**
 * Compose the opt-in text-stream transforms over the merged event stream, in fixed order:
 * `<think>`-tag extraction (M2) first, then tool-dialect stripping (theocode#32) on the post-think
 * `text_delta`. Both default off ⇒ the merged stream is returned unchanged (byte-identical).
 */
function applyTextTransforms(
  events: AsyncIterable<StreamEvent>,
  opts: { parseThinkTags: boolean; stripToolDialect: boolean },
): AsyncIterable<StreamEvent> {
  let out = opts.parseThinkTags ? extractThinkTagStream(events) : events
  if (opts.stripToolDialect) out = stripToolDialectStream(out)
  return out
}

/**
 * A tool whose `inputSchema` is a live Zod schema (from `@Tool({ input })`) needs the SDK's
 * `defineTool` to lower it to JSON Schema + wrap parsing. A tool whose `inputSchema` is already a
 * JSON-Schema object (from `defineAgentTool`, which pre-converts via `z.toJSONSchema`) is ALREADY an
 * SDK-ready `CustomTool` and MUST be appended raw — re-running it through `defineTool` (which reads
 * Zod internals like `.def`) crashes. Every Zod schema exposes `.parse`; a JSON-Schema object does not.
 */
function hasZodInputSchema(schema: unknown): boolean {
  return typeof (schema as { parse?: unknown } | null | undefined)?.parse === 'function'
}

/**
 * M7 — wrap a tool handler so it receives the run-context as `ctx.context`, injected from a closure
 * over `runContext`. theokit owns the run-context concern (the `defineAgent({ context })` /
 * `agent().context()` API is theokit's), so it injects it at THIS adapter layer instead of relying
 * on the SDK to forward it — decoupling the framework from the SDK's tool-call internals. The
 * incoming `ctx.signal` (from the SDK) is preserved; `context` is set to the agent's run-context.
 */
function withRunContext<I>(
  handler: (
    input: I,
    ctx?: { signal?: AbortSignal; context?: unknown },
  ) => string | Promise<string>,
  runContext: unknown,
): (input: I, ctx?: { signal?: AbortSignal; context?: unknown }) => string | Promise<string> {
  return (input, ctx) => handler(input, { signal: ctx?.signal, context: runContext })
}

/**
 * Build the SDK tool list: `@Tool`s (Zod `inputSchema`) lowered via `defineTool`; `defineAgentTool`
 * results (already SDK-ready `CustomTool`s with a JSON-Schema `inputSchema`) and any pre-built
 * `sdkTools` appended RAW — must NOT re-run through `defineTool` (V4-Q). Extracted for G6.
 *
 * When `runContext` is set, every tool handler is wrapped to receive it as `ctx.context` (M7);
 * `undefined` ⇒ handlers are passed through unwrapped (byte-identical to pre-M7).
 */
function buildSdkTools(
  compiledTools: CompiledTool[],
  defineTool: (spec: {
    name: string
    description: string
    inputSchema: unknown
    handler: (
      input: unknown,
      ctx?: { signal?: AbortSignal; context?: unknown },
    ) => string | Promise<string>
  }) => unknown,
  extraSdkTools: readonly CustomTool[] = [],
  runContext?: unknown,
): unknown[] {
  const has = runContext !== undefined
  return [
    ...compiledTools.map((t) => {
      if (hasZodInputSchema(t.inputSchema)) {
        return defineTool({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          handler: has ? withRunContext(t.handler, runContext) : t.handler,
        })
      }
      // Already an SDK-ready CustomTool (JSON-Schema inputSchema) — forward RAW (same reference)
      // unless a run-context must be injected into its handler.
      return has ? { ...t, handler: withRunContext(t.handler, runContext) } : t
    }),
    ...extraSdkTools.map((t) =>
      has ? { ...t, handler: withRunContext(t.handler, runContext) } : t,
    ),
  ]
}

/**
 * Creates an agent stream factory using @theokit/sdk as the runtime.
 *
 * Returns a function that, given a message + sessionId, yields TheoKit
 * AgentStreamEvent via the SDK's Agent.create() + Run.stream() pipeline.
 */
export function createSdkAgentStream(
  compiled: CompiledAgentOptions,
  compiledTools: CompiledTool[],
  apiKey: string,
  overrides: RuntimeOverrides = {},
) {
  const model = overrides.model ?? compiled.model ?? 'openai/gpt-4o-mini'
  // M1 reasoning-visibility: per-run effort overrides the compiled @Agent effort (mirrors `model`).
  const reasoningEffort = overrides.reasoningEffort ?? compiled.reasoningEffort
  // Per-run opt-in text-stream transforms (each overrides the compiled @Agent flag, mirrors `model`):
  // parseThinkTags (M2, <think> extraction), stripToolDialect (theocode#32, leaked-dialect strip).
  const { parseThinkTags, stripToolDialect } = resolveTextTransformFlags(compiled, overrides)
  // M7 — run-context resolved once per stream: per-run override wins over the agent-level
  // `defineAgent({ context })`; injected into every tool's `ctx.context` by buildSdkTools.
  const runContext = overrides.runContext ?? compiled.runContext
  // V4-M: ONE conversation store shared across the loop's rounds (closure-scoped per run)
  // so history persists across the per-round agent create/dispose. Defaults lazily to the
  // SDK's in-memory store (no disk) after the dynamic import; an app override wins.
  // Precedence: per-run override > agent-level `defineAgent({ conversationStorage })`
  // (compiled.conversationStorage) > SDK default (chosen lazily below).
  let storage: ConversationStorageAdapter | undefined =
    overrides.conversationStorage ?? compiled.conversationStorage

  // `factoryOpts.disableTools` (step-cap force-close) → `tool_choice:"none"` at send-time.
  return (
    message: string,
    sessionId: string,
    factoryOpts?: { disableTools?: boolean },
  ): AsyncIterable<StreamEvent> => ({
    async *[Symbol.asyncIterator]() {
      const runId = `run-${Date.now()}`
      const t0 = Date.now()

      // Dynamic import — @theokit/sdk is optional peer dep (null ⇒ not installed).
      const rt = await loadSdkRuntime()
      if (!rt) {
        yield {
          type: 'error',
          code: 'SDK_NOT_INSTALLED',
          message: 'Install @theokit/sdk: pnpm add @theokit/sdk',
          retryable: false,
        }
        return
      }

      const { InMemoryConversationStorage, FileSystemConversationStorage } = rt

      // M7 — pass the resolved run-context so every tool handler receives it as `ctx.context`.
      const sdkTools = buildSdkTools(compiledTools, rt.defineTool, overrides.sdkTools, runContext)

      // Auto-wire `skill_read` for inline skills (`defineAgent({ skills: [inlineSkill] })`). An inline
      // skill lists in the `<skills>` block by name + description only — its body is unreachable to the
      // model without the `skill_read` tool, so registering an inline skill implies wanting it readable.
      // One `.skills([...])` call thus both registers AND makes the skill readable. Dedup: skip when the
      // app already declared a `skill_read` (an explicit `defineSkillReadTool` wins). Graceful: skip when
      // the loaded SDK predates `defineSkillReadTool` (inline skills still list, just not auto-readable).
      const inlineSkills = compiled.skills?.inline
      if (
        inlineSkills !== undefined &&
        inlineSkills.length > 0 &&
        rt.defineSkillReadTool !== undefined &&
        !compiledTools.some((t) => t.name === 'skill_read')
      ) {
        sdkTools.push(rt.defineSkillReadTool(inlineSkills))
      }
      // Wiring triad pillar (c) — M7 run-context metric: observable proof that context injection is active.
      let runContextSource: string
      if (overrides.runContext !== undefined) {
        runContextSource = 'per-run'
      } else if (compiled.runContext !== undefined) {
        runContextSource = 'agent-level'
      } else {
        runContextSource = 'none'
      }
      debugLog('[THEO_AGENT_M7_RUN_CONTEXT]', {
        source: runContextSource,
        keys: runContext !== undefined ? Object.keys(runContext) : [],
      })

      // V4-M/M4: mutate the closure-level `storage` variable so it is shared across rounds
      // (subsequent calls to this generator reuse the same store — ONE per factory instance).
      storage ??= newConversationStorage(
        compiled,
        InMemoryConversationStorage,
        FileSystemConversationStorage,
      )

      try {
        yield* streamSdkAgent(rt, compiled, sdkTools, storage, {
          apiKey,
          model,
          reasoningEffort,
          overrides,
          parseThinkTags,
          stripToolDialect,
          sessionId,
          message,
          factoryOpts,
          runId,
          t0,
        })
      } catch (err) {
        yield {
          type: 'error',
          code: 'SDK_ERROR',
          message: err instanceof Error ? err.message : 'SDK agent error',
          retryable: false,
        }
      }
    },
  })
}

interface StreamSdkAgentOpts {
  apiKey: string
  model: string
  reasoningEffort: string | undefined
  overrides: RuntimeOverrides
  parseThinkTags: boolean
  stripToolDialect: boolean
  sessionId: string
  message: string
  factoryOpts: { disableTools?: boolean } | undefined
  runId: string
  t0: number
}

/**
 * Inner streaming kernel (G6 extraction): creates the SDK agent, runs the send+stream loop,
 * and disposes. Errors propagate to the outer generator's catch. The `finally` inside guarantees
 * disposal even when `run.wait()` rejects (V4-N.1).
 */
async function* streamSdkAgent(
  rt: SdkRuntime,
  compiled: CompiledAgentOptions,
  sdkTools: unknown[],
  storage: ConversationStorageAdapter,
  opts: StreamSdkAgentOpts,
): AsyncGenerator<StreamEvent> {
  const { Agent } = rt
  const {
    apiKey,
    model,
    reasoningEffort,
    overrides,
    parseThinkTags,
    stripToolDialect,
    sessionId,
    message,
    factoryOpts,
    runId,
    t0,
  } = opts

  // Project the compiled M8 decorator fields into native Agent.create args.
  const { options: m8, applied } = assembleM8CreateOptions(compiled)
  if (overrides.cwd !== undefined) m8.local = { ...m8.local, cwd: overrides.cwd }
  const extra = buildExtraCreateOptions(overrides, compiled)
  if (applied.length > 0) {
    // Wiring triad — runtime metric: observable proof the decorators fired (opt-in via THEOKIT_DEBUG).
    debugLog('[THEO_AGENT_M8_RUNTIME_APPLIED]', {
      skills: applied.includes('skills'),
      contextWindow: applied.includes('context'),
      projectContext: applied.includes('projectContext'),
    })
  }

  // V4-N.1: declared before try so `finally` can dispose even when `run.wait()` rejects.
  const agent = await Agent.getOrCreate(sessionId, {
    apiKey,
    model: buildModelSelection(model, reasoningEffort),
    tools: sdkTools,
    ...m8,
    ...extra,
    conversationStorage: storage,
  })
  try {
    // #44: chronological token streaming via onDelta + merge queue (see createDeltaSink).
    const queue = createAsyncQueue<MergeItem>()
    const { state, onDelta } = createDeltaSink(queue)
    const sendOptions: SendOptions = { onDelta }
    if (factoryOpts?.disableTools === true) sendOptions.toolChoice = 'none'
    const sendPromise = agent.send(message, sendOptions)
    const openStream = async () => (await sendPromise).stream()
    const merged = mergeDeltaStream(queue, openStream, runId, state)
    for await (const event of applyTextTransforms(merged, { parseThinkTags, stripToolDialect })) {
      yield event
    }
    // V4-N.1: ONE real-usage `done` after run.wait(); errors short-circuit it.
    if (!state.sawError) {
      yield realUsageDone(await (await sendPromise).wait(), t0)
    }
  } finally {
    await agent.dispose()
  }
}
