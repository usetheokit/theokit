/**
 * SDK Adapter — bridges @theokit/agents decorators → @theokit/sdk runtime.
 *
 * Per rule sdk-runtime.md (INQUEBRÁVEL): @theokit/sdk is the ONLY agent runtime.
 * This adapter replaces llm-runner.ts (which called OpenRouter API directly).
 *
 * Flow: @Agent decorator → compileAgent() → createSdkAgentStream() → SDK Agent.create() → Run.stream()
 */
import type { ContextSettings, SkillsSettings, SystemPromptResolver } from '@theokit/sdk'

import type { CompiledAgentOptions, CompiledTool } from './agent-compiler.js'
import type { StreamEvent } from './agent-sse-handler.js'
import { compileProjectContext } from './compile-project-context.js'
import { translateSdkEvent, type SdkMessage } from './event-translator.js'

/** Extra `Agent.create()` options compiled from the M8 declarative decorators. */
interface M8CreateOptions {
  skills?: SkillsSettings
  context?: ContextSettings
  systemPrompt?: string | SystemPromptResolver
  /** Settings source so the SDK can discover SKILL.md files (EC-1). */
  local?: { settingSources: string[] }
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
 * Creates an agent stream factory using @theokit/sdk as the runtime.
 *
 * Returns a function that, given a message + sessionId, yields TheoKit
 * AgentStreamEvent via the SDK's Agent.create() + Run.stream() pipeline.
 */
export function createSdkAgentStream(
  compiled: CompiledAgentOptions,
  compiledTools: CompiledTool[],
  apiKey: string,
  envModel?: string,
) {
  const model = envModel ?? compiled.model ?? 'openai/gpt-4o-mini'

  return (message: string, _sessionId: string): AsyncIterable<StreamEvent> => ({
    async *[Symbol.asyncIterator]() {
      const runId = `run-${Date.now()}`
      const t0 = Date.now()

      // Dynamic import — @theokit/sdk is optional peer dep
      let Agent: {
        create: (opts: Record<string, unknown>) => Promise<{
          send: (msg: string) => Promise<{ stream: () => AsyncGenerator<SdkMessage> }>
          dispose: () => Promise<void>
        }>
      }
      let defineTool: (spec: {
        name: string
        description: string
        inputSchema: unknown
        handler: (input: unknown) => string | Promise<string>
      }) => unknown

      try {
        const sdk = await import('@theokit/sdk')
        Agent = sdk.Agent as typeof Agent
        defineTool = sdk.defineTool as typeof defineTool
      } catch {
        yield {
          type: 'error',
          code: 'SDK_NOT_INSTALLED',
          message: 'Install @theokit/sdk: pnpm add @theokit/sdk',
          retryable: false,
        }
        return
      }

      // Convert compiled tools → SDK defineTool format
      const sdkTools = compiledTools.map((t) =>
        defineTool({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          handler: t.handler,
        }),
      )

      try {
        // Project the compiled M8 decorator fields into native Agent.create args.
        const { options: m8, applied } = assembleM8CreateOptions(compiled)
        if (applied.length > 0) {
          // Wiring triad — runtime metric: observable proof the decorators fired.
          console.debug('[THEO_AGENT_M8_RUNTIME_APPLIED]', {
            skills: applied.includes('skills'),
            context: applied.includes('context'),
            projectContext: applied.includes('projectContext'),
          })
        }

        // Create SDK agent (M8 fields spread; absent decorators add no keys)
        const agent = await Agent.create({
          apiKey,
          model: { id: model },
          tools: sdkTools,
          ...m8,
        })

        // Send message + stream response
        const run = await agent.send(message)

        let sawTerminal = false
        for await (const sdkEvent of run.stream()) {
          const translated = translateSdkEvent(sdkEvent, runId)
          for (const event of translated) {
            if (event.type === 'done' || event.type === 'error') sawTerminal = true
            yield event
          }
        }

        // Fallback terminal: only when the SDK stream did NOT already yield one
        // (a real run ends in a `status: FINISHED`/`ERROR` message → translated to
        // done/error). The loop's B1 guarantee relies on a terminal existing; this
        // keeps exactly-one-terminal without double-emitting to SSE consumers.
        if (!sawTerminal) {
          yield {
            type: 'done',
            result: '',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            durationMs: Date.now() - t0,
            cost: 0,
          }
        }

        await agent.dispose()
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
