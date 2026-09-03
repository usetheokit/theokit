/**
 * SDK-adapter create-options projection — extracted from `sdk-adapter.ts` (G6 file-size split).
 *
 * Two pure helpers the streaming adapter uses to talk to the SDK:
 *  - `assembleM8CreateOptions` projects the compiled `@Agent` decorator fields into `Agent.create()`
 *    arguments (the single compile site is `agent-compiler.ts`, per sdk-runtime.md);
 *  - `realUsageDone` builds the terminal `done` StreamEvent from the SDK `RunResult`.
 */
import { createRequire } from 'node:module'

import type { ContextSettings, SkillsSettings, SystemPromptResolver } from '@theokit/sdk'
import type { MemorySettings } from '@theokit/sdk'

import type { McpServersMap } from '../types.js'

import type { CompiledAgentOptions } from './agent-compiler.js'
import type { StreamEvent } from './agent-sse-handler.js'
import type { AgentStopReason, DoneEvent } from './agent-stream-events.js'
import { compileProjectContext } from './compile-project-context.js'

/** Extra `Agent.create()` options compiled from the M8 declarative decorators. */
interface M8CreateOptions {
  skills?: SkillsSettings
  context?: ContextSettings
  systemPrompt?: string | SystemPromptResolver
  /** SDK local options: settings source for SKILL.md discovery (EC-1) + per-run cwd (V4-L.2). */
  local?: { settingSources?: string[]; compatSources?: string[]; cwd?: string; baseDir?: string }
  plugins?: readonly unknown[]
  /** #89 — `@MCP` servers forwarded to `Agent.create({ mcpServers })` (the SDK owns execution). */
  mcpServers?: McpServersMap
  /** M49 — durable-memory settings forwarded to `Agent.create({ memory })` (SDK MemorySettings). */
  memory?: MemorySettings
}

/**
 * Project the M8 fields from `CompiledAgentOptions` into `Agent.create()` arguments. Only the async
 * `@ProjectContext` resolver is built here (it does I/O, so the compiler keeps it raw). `applied`
 * lists which decorators contributed, for the observability log (wiring triad — runtime metric).
 */
/** Reported once per process — a warning repeated per agent stops being read. */
let sdkCompatWarningEmitted = false

/**
 * Warns when the installed SDK is too old to know `compatSources`, instead of letting it vanish.
 *
 * ## Why this lives here and not upstream
 *
 * `theokit-sdk#526` makes the SDK name an unrecognised key under `local` — and it only exists in
 * the SDK that already supports `compatSources`. So it covers exactly the half where no warning is
 * needed, and is absent from the half where one is. This layer is the only place that sees both.
 *
 * ## Why this does not require raising the floor
 *
 * `@theokit/sdk` declares `"./package.json"` in `exports`, so its version is readable at runtime.
 * That is what made `usetheokit/theokit#634` buildable before a stable cut: the blocker was never
 * the missing type — a string union is declarable here — it was that a forward against an older SDK
 * would be inert IN SILENCE. Reading the version removes the silence, and the floor stays
 * `^4.52.1`, so no consumer is pinned to a prerelease.
 *
 * Failure to read it is not an error: a bundled or vendored SDK may not resolve that subpath, and
 * refusing to create an agent over a diagnostic would be the cure being worse than the disease.
 */
function warnIfSdkCannotReadCompatSources(): void {
  if (sdkCompatWarningEmitted) return
  let version: string | undefined
  try {
    version = (createRequire(import.meta.url)('@theokit/sdk/package.json') as { version?: string })
      .version
  } catch {
    return // cannot tell — say nothing rather than guess
  }
  const major = Number.parseInt(version?.split('.')[0] ?? '', 10)
  if (!Number.isFinite(major) || major >= 5) return
  sdkCompatWarningEmitted = true
  console.warn(
    `[theokit/agents] \`compatSources\` was declared, but @theokit/sdk@${version} does not know ` +
      `that option and will ignore it — the foreign configuration root will NOT be read. It landed ` +
      `in 5.0.0. Until this package's floor can name a stable 5.x, override the SDK in your ` +
      `workspace (usetheokit/theokit#634).`,
  )
}

export function assembleM8CreateOptions(compiled: CompiledAgentOptions): {
  options: M8CreateOptions
  applied: string[]
} {
  const options: M8CreateOptions = {}
  const applied: string[] = []
  const base = compiled.systemPrompt

  if (compiled.skills) {
    options.skills = compiled.skills
    applied.push('skills')
  }
  // theokit-file-based-config — project `.theokit/` discovery sources into `local`, DECOUPLED from
  // inline skills (an agent may want hooks/mcp/subagents/context/cron with no inline skill). cwd is
  // merged downstream (`sdk-adapter.ts` overrides.cwd → app root via `mount-agent.ts`); never dropped.
  // Code `Plugin` objects (e.g. `createToolHooksPlugin`) — registered directly by the runtime
  // (`extractCodePlugins`); this is the fluent builder's only route to the SDK lifecycle-hook seam.
  if (compiled.plugins) {
    options.plugins = compiled.plugins
    applied.push('plugins')
  }
  // M68 — already resolved. `CompiledAgentOptions.settingSources` can only hold roots some posture
  // authorized, because every authoring path runs the selection through `resolveSettingSources`
  // (the gate) at compile time. This is a projection, not a decision.
  //
  // Two things died here, and both were the defect. A LOCAL function named `resolveSettingSources`
  // — same name as the gate, consulting no posture — is what this line used to call, so a grep for
  // the gate landed on a homonym and the gate looked wired. And that homonym injected `['project']`
  // whenever the agent declared inline skills, "for back-compat": declaring a skill is a statement
  // about prompts, and it was silently enabling shell execution from the working directory.
  if (compiled.settingSources !== undefined && compiled.settingSources.length > 0) {
    options.local = { ...options.local, settingSources: [...compiled.settingSources] }
    applied.push('settingSources')
  }
  // #634 — spread over `options.local` rather than replacing it, because `settingSources` above
  // projects onto the same object and the second write eating the first is the ordinary way this
  // breaks: invisibly, with each option passing its own test.
  if (compiled.compatSources !== undefined && compiled.compatSources.length > 0) {
    options.local = { ...options.local, compatSources: [...compiled.compatSources] }
    applied.push('compatSources')
    warnIfSdkCannotReadCompatSources()
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
  // #89 — forward the compiled `@MCP` servers to `Agent.create`. Without this the decorator was
  // inert (metadata compiled but never reaching the SDK runtime — same class as the HITL
  // `kind:'general'` bug). The SDK owns MCP server execution; this is pure adapter projection.
  if (compiled.mcpServers && Object.keys(compiled.mcpServers).length > 0) {
    options.mcpServers = compiled.mcpServers
    applied.push('mcpServers')
  }
  // M49 — forward memory to `Agent.create` (same inert-decorator class as #89: the field compiled
  // but never projected, so the SDK's whole memory subsystem was unreachable). Builder path carries
  // the SDK `MemorySettings` verbatim; the legacy decorator shape (no `enabled`) normalizes to the
  // minimal opt-in — declaring `@Memory()` means the author wants memory ON.
  if (compiled.memory !== undefined) {
    if ('enabled' in compiled.memory) {
      options.memory = compiled.memory
    } else {
      // Legacy decorator shape ({provider, embeddings, fts, scope, maxFacts}) — those knobs have no
      // SDK counterpart yet, so they are DISCARDED on normalization. Loud, never silent (M49 review
      // F8): the author asked for e.g. maxFacts and must know it is not honored.
      const dropped = Object.keys(compiled.memory)
      if (dropped.length > 0) {
        process.stderr.write(
          `[theokit-agents] @Memory decorator options not yet mapped to the SDK (${dropped.join(', ')}) — memory enabled with defaults\n`,
        )
      }
      options.memory = { enabled: true }
    }
    applied.push('memory')
  }

  return { options, applied }
}

/**
 * theokit#379 — map the SDK `RunResult`'s two truncation flags onto the framework's stop reason, or
 * `undefined` when the run finished on its own.
 *
 * The precedence is NOT a preference. It mirrors the SDK's own `classifyRound`
 * (`run-to-completion.ts`, read from the shipped bundle), which tests `stoppedByDoomLoop` FIRST and
 * only then `stoppedAtIterationLimit`. A doom-loop stop is the more specific verdict and the one
 * that must not be re-sent, so a caller reading our reason and a caller reading the SDK's driver
 * reach the same decision instead of disagreeing about a run both observed.
 */
function stopReasonOf(result: {
  stoppedAtIterationLimit?: boolean
  stoppedByDoomLoop?: boolean
}): AgentStopReason | undefined {
  if (result.stoppedByDoomLoop === true) return 'no_progress'
  if (result.stoppedAtIterationLimit === true) return 'step_limit'
  return undefined
}

/**
 * V4-N.1: build the terminal `done` event from the SDK `RunResult` (real per-run token usage +
 * cost). Extracted from the stream generator to keep its complexity within budget (G6).
 *
 * theokit#379: it also carries WHY the run stopped. Until then this read three fields off a run
 * object that reports more, so a run the SDK cut at its iteration ceiling — which, absent a declared
 * `maxIterations`, is every served run needing more than the SDK's default of 8 tool-calling turns —
 * reached the caller as an ordinary `done`.
 */
export function realUsageDone(
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
    // theokit#379: the SDK's truncation flags. Optional — absent on a clean finish and on an SDK
    // that predates them, which is the degradation this layer wants.
    stoppedAtIterationLimit?: boolean
    stoppedByDoomLoop?: boolean
  },
  t0: number,
  /**
   * The model the turn ran on, already resolved by the caller
   * (`overrides.model ?? compiled.model ?? default`). It is a PARAMETER rather than something read
   * off `compiled` here for the reason {@link DoneEvent.model} states: `compiled.model` is the
   * declared model, and the declared model is not always the one that ran.
   *
   * Optional, so the two integration tests that call this with a bare `RunResult` keep compiling
   * and keep asserting the same event they always did.
   */
  model?: string,
): StreamEvent {
  const u = result.usage
  const inputTokens = u?.inputTokens ?? 0
  const outputTokens = u?.outputTokens ?? 0
  const stopReason = stopReasonOf(result)
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
    ...terminalExtras(stopReason, model),
  }
}

/**
 * The terminal frame's OPTIONAL keys, spread rather than assigned as `undefined`.
 *
 * theokit#379: a clean run's `done` must stay byte-identical to what it was before `stopReason`
 * shipped — absence is what means "finished", so a key holding `undefined` would be a new, noisy
 * field on every uncapped run. The same discipline applies to the model: a producer with none to
 * report emits the event it emitted before, key for key.
 *
 * They live in their own function rather than inline in {@link realUsageDone} because that function
 * was already at the complexity ceiling, and two more conditional keys is exactly the growth the
 * ceiling exists to notice.
 */
function terminalExtras(
  stopReason: AgentStopReason | undefined,
  model: string | undefined,
): { stopReason?: AgentStopReason; model?: string } {
  const extras: { stopReason?: AgentStopReason; model?: string } = {}
  if (stopReason !== undefined) extras.stopReason = stopReason
  if (model !== undefined) extras.model = model
  return extras
}
