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
  PluginsSettings,
  ProviderRoutingSettings,
  SkillsSettings,
  SystemPromptResolver,
} from '@theokit/sdk'

import type { CompiledAgentOptions, CompiledTool } from './agent-compiler.js'
import type { StreamEvent } from './agent-sse-handler.js'
import { compileProjectContext } from './compile-project-context.js'
import { translateSdkEvent, type SdkMessage } from './event-translator.js'

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
  /** Per-run cwd → `Agent.create({ local: { cwd } })` → `SystemPromptContext.cwd`. */
  cwd?: string
  /** Per-run plugins (e.g. permission gate selected by request mode). */
  plugins?: PluginsSettings
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
  // V4-M: ONE conversation store shared across the loop's rounds (closure-scoped per run)
  // so history persists across the per-round agent create/dispose. Defaults lazily to the
  // SDK's in-memory store (no disk) after the dynamic import; an app override wins.
  let storage: ConversationStorageAdapter | undefined = overrides.conversationStorage

  return (message: string, sessionId: string): AsyncIterable<StreamEvent> => ({
    async *[Symbol.asyncIterator]() {
      const runId = `run-${Date.now()}`
      const t0 = Date.now()

      // Dynamic import — @theokit/sdk is optional peer dep
      let Agent: {
        getOrCreate: (
          id: string,
          opts: Record<string, unknown>,
        ) => Promise<{
          send: (msg: string) => Promise<{
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
          model: { id: model },
          tools: sdkTools,
          ...m8,
          ...extra,
          conversationStorage: storage,
        })

        // Send message + stream response
        const run = await agent.send(message)

        // V4-N.1: the stream's `done` carries zero usage (the FINISHED status has no token
        // totals). Suppress it and emit ONE real-usage `done` after `run.wait()` (which carries
        // the SDK RunResult.usage + cost). Errors pass through and short-circuit the re-emit.
        let sawError = false
        for await (const sdkEvent of run.stream()) {
          for (const event of translateSdkEvent(sdkEvent, runId)) {
            if (event.type === 'done') continue // suppressed; the real one is emitted below
            if (event.type === 'error') sawError = true
            yield event
          }
        }

        // Exactly-one-terminal: on a clean run, read the SDK RunResult for real usage + cost.
        if (!sawError) {
          yield realUsageDone(await run.wait(), t0)
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
