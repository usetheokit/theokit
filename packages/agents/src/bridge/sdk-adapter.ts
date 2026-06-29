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
  ContextSettings,
  ConversationStorageAdapter,
  CustomTool,
  InteractionUpdate,
  Plugin,
  PluginsSettings,
  ProviderRoutingSettings,
  SkillsSettings,
  SystemPromptResolver,
} from '@theokit/sdk'

import type { ReasoningEffort } from '../types.js'

import type { CompiledAgentOptions, CompiledTool } from './agent-compiler.js'
import type { StreamEvent } from './agent-sse-handler.js'
import { compileProjectContext } from './compile-project-context.js'
import {
  translateInteractionUpdate,
  translateSdkEvent,
  type SdkMessage,
} from './event-translator.js'
import { buildModelSelection } from './model-selection.js'
import { extractThinkTagStream } from './think-tag-extractor.js'

/** Extra `Agent.create()` options compiled from the M8 declarative decorators. */
interface M8CreateOptions {
  skills?: SkillsSettings
  context?: ContextSettings
  systemPrompt?: string | SystemPromptResolver
  /** SDK local options: settings source for SKILL.md discovery (EC-1) + per-run cwd (V4-L.2). */
  local?: { settingSources?: string[]; cwd?: string }
}

/**
 * Project the M8 fields from `CompiledAgentOptions` (the single compile site is
 * `agent-compiler.ts`, per sdk-runtime.md) into `Agent.create()` arguments. Only
 * the async `@ProjectContext` resolver is built here (it does I/O, so the compiler
 * keeps it raw). `applied` lists which decorators contributed, for the
 * observability log (wiring triad — runtime metric).
 */
function assembleM8CreateOptions(compiled: CompiledAgentOptions): {
  options: M8CreateOptions
  applied: string[]
} {
  const options: M8CreateOptions = {}
  const applied: string[] = []
  const base = compiled.systemPrompt

  if (compiled.skills) {
    options.skills = compiled.skills
    options.local = { settingSources: ['project'] }
    applied.push('skills')
  }
  if (compiled.context) {
    options.context = compiled.context
    applied.push('context')
  }
  if (compiled.projectContext) {
    options.systemPrompt = compileProjectContext(compiled.projectContext, base)
    applied.push('projectContext')
  } else if (base !== undefined) {
    options.systemPrompt = base
  }

  return { options, applied }
}

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
  /** Per-run cwd → `Agent.create({ local: { cwd } })` → `SystemPromptContext.cwd`. */
  cwd?: string
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
 * V4-N.1: build the terminal `done` event from the SDK `RunResult` (real per-run token usage +
 * cost). Extracted from the stream generator to keep its complexity within budget (G6).
 */
function realUsageDone(
  result: {
    result?: string
    usage?: {
      inputTokens?: number
      outputTokens?: number
      // V4-O: optional reasoning/cache buckets from the SDK TokenUsage.
      reasoningTokens?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
    }
    cost?: { amount?: number }
  },
  t0: number,
): StreamEvent {
  const u = result.usage
  const inputTokens = u?.inputTokens ?? 0
  const outputTokens = u?.outputTokens ?? 0
  return {
    type: 'done',
    result: result.result ?? '',
    // V4-O: forward the SDK reasoning/cache buckets (0 when the provider omits them) so a
    // consumer keeps full per-turn usage through the loop into DelegationResult (passthrough — ADR D1).
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      reasoningTokens: u?.reasoningTokens ?? 0,
      cacheReadTokens: u?.cacheReadTokens ?? 0,
      cacheWriteTokens: u?.cacheWriteTokens ?? 0,
    },
    durationMs: Date.now() - t0,
    cost: result.cost?.amount ?? 0,
  }
}

/**
 * Project the V4-L.3 per-request fields into the `Agent.create` extra surface (absent ⇒ no
 * key). Extracted from the stream generator to keep its cyclomatic complexity within budget (G6).
 */
function buildExtraCreateOptions(overrides: RuntimeOverrides): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  if (overrides.plugins !== undefined) extra.plugins = overrides.plugins
  if (overrides.providers !== undefined) extra.providers = overrides.providers
  if (overrides.agents !== undefined) extra.agents = overrides.agents
  if (overrides.budgetTracker !== undefined) extra.budgetTracker = overrides.budgetTracker
  return extra
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
  // M2 reasoning-visibility: per-run opt-in overrides the compiled @Agent flag (mirrors `model`).
  const parseThinkTags = overrides.parseThinkTags ?? compiled.parseThinkTags ?? false
  // V4-M: ONE conversation store shared across the loop's rounds (closure-scoped per run)
  // so history persists across the per-round agent create/dispose. Defaults lazily to the
  // SDK's in-memory store (no disk) after the dynamic import; an app override wins.
  let storage: ConversationStorageAdapter | undefined = overrides.conversationStorage

  // `factoryOpts.disableTools` (step-cap force-close) → `tool_choice:"none"` at send-time.
  return (
    message: string,
    sessionId: string,
    factoryOpts?: { disableTools?: boolean },
  ): AsyncIterable<StreamEvent> => ({
    async *[Symbol.asyncIterator]() {
      const runId = `run-${Date.now()}`
      const t0 = Date.now()

      // Dynamic import — @theokit/sdk is optional peer dep
      let Agent: {
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
      let defineTool: (spec: {
        name: string
        description: string
        inputSchema: unknown
        handler: (input: unknown) => string | Promise<string>
      }) => unknown
      let InMemoryConversationStorage: new () => ConversationStorageAdapter

      try {
        const sdk = await import('@theokit/sdk')
        Agent = sdk.Agent
        defineTool = sdk.defineTool as typeof defineTool
        InMemoryConversationStorage = sdk.InMemoryConversationStorage
      } catch {
        yield {
          type: 'error',
          code: 'SDK_NOT_INSTALLED',
          message: 'Install @theokit/sdk: pnpm add @theokit/sdk',
          retryable: false,
        }
        return
      }

      // Convert compiled tools → SDK defineTool format; V4-Q: append pre-built SDK CustomTool[]
      // RAW (already defined — must NOT be re-run through defineTool, which requires a Zod schema).
      const sdkTools = [
        ...compiledTools.map((t) =>
          defineTool({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            handler: t.handler,
          }),
        ),
        ...(overrides.sdkTools ?? []),
      ]

      // V4-N.1: declared outside the try so `finally` can dispose even when `run.wait()` rejects.
      let agent: Awaited<ReturnType<typeof Agent.getOrCreate>> | undefined
      try {
        // Project the compiled M8 decorator fields into native Agent.create args.
        const { options: m8, applied } = assembleM8CreateOptions(compiled)
        // V4-L.2: merge the per-run cwd into local (preserving any settingSources).
        if (overrides.cwd !== undefined) m8.local = { ...m8.local, cwd: overrides.cwd }
        // V4-L.3: forward the remaining per-request Agent.create surface (absent ⇒ no key).
        const extra = buildExtraCreateOptions(overrides)
        // V4-M: the shared store is the cross-round memory (survives per-round dispose).
        storage ??= new InMemoryConversationStorage()
        if (applied.length > 0) {
          // Wiring triad — runtime metric: observable proof the decorators fired.
          console.debug('[THEO_AGENT_M8_RUNTIME_APPLIED]', {
            skills: applied.includes('skills'),
            context: applied.includes('context'),
            projectContext: applied.includes('projectContext'),
          })
        }

        // V4-M: getOrCreate(sessionId) resumes the shared session so this round sees prior
        // rounds (M8 fields + per-request extra spread; absent ⇒ no key).
        agent = await Agent.getOrCreate(sessionId, {
          apiKey,
          model: buildModelSelection(model, reasoningEffort),
          tools: sdkTools,
          ...m8,
          ...extra,
          conversationStorage: storage,
        })

        // #44: token streaming in CHRONOLOGICAL ORDER. The SDK streams ALL content updates
        // (text/tool/thinking) in real time via send's onDelta; run.stream() replays the complete
        // messages post-completion. Route every content update through onDelta in arrival order so
        // the merge queue records them interleaved (not all-text-then-all-tools), and consume the
        // queue CONCURRENTLY with send (the run only resolves after the loop). run.stream() supplies
        // structural events + the no-onDelta fallback, deduped per-category/callId (isDuplicatedByDelta).
        const queue = createAsyncQueue<MergeItem>()
        const { state, onDelta } = createDeltaSink(queue)
        // Do NOT await send() before draining — onDelta fills the queue in real time during the run;
        // the consumer yields concurrently. openStream awaits the resolved Run for its post-completion
        // run.stream(). On send() rejection, openStream throws → pump closes the queue → the awaited
        // pump re-throws into the outer catch (error event) after any queued deltas have drained.
        // Step-cap force-close: a ceiling round passes `disableTools` → `tool_choice:"none"` for this send.
        const sendPromise = agent.send(
          message,
          factoryOpts?.disableTools === true ? { onDelta, toolChoice: 'none' } : { onDelta },
        )
        const openStream = async () => (await sendPromise).stream()

        // M2: when opted in, extract inline `<think>…</think>` from the text stream into thinking
        // events. Off by default ⇒ the merged stream is yielded unchanged (byte-identical).
        const merged = mergeDeltaStream(queue, openStream, runId, state)
        const events = parseThinkTags ? extractThinkTagStream(merged) : merged
        for await (const event of events) {
          yield event
        }

        // V4-N.1: the stream's `done` carries zero usage; it is suppressed in mergeDeltaStream and
        // ONE real-usage `done` is emitted after `run.wait()` (SDK RunResult.usage + cost). Errors
        // short-circuit it. Exactly-one-terminal on a clean run.
        if (!state.sawError) {
          yield realUsageDone(await (await sendPromise).wait(), t0)
        }
      } catch (err) {
        yield {
          type: 'error',
          code: 'SDK_ERROR',
          message: err instanceof Error ? err.message : 'SDK agent error',
          retryable: false,
        }
      } finally {
        // V4-N.1: always dispose — covers the new `run.wait()` reject path (LOW-1).
        await agent?.dispose()
      }
    },
  })
}
