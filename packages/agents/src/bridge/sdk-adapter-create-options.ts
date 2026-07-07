/**
 * SDK-adapter create-options projection — extracted from `sdk-adapter.ts` (G6 file-size split).
 *
 * Two pure helpers the streaming adapter uses to talk to the SDK:
 *  - `assembleM8CreateOptions` projects the compiled `@Agent` decorator fields into `Agent.create()`
 *    arguments (the single compile site is `agent-compiler.ts`, per sdk-runtime.md);
 *  - `realUsageDone` builds the terminal `done` StreamEvent from the SDK `RunResult`.
 */
import type { ContextSettings, SkillsSettings, SystemPromptResolver } from '@theokit/sdk'

import type { McpServersMap } from '../decorators/mcp.js'

import type { CompiledAgentOptions } from './agent-compiler.js'
import type { StreamEvent } from './agent-sse-handler.js'
import { compileProjectContext } from './compile-project-context.js'

/** Extra `Agent.create()` options compiled from the M8 declarative decorators. */
export interface M8CreateOptions {
  skills?: SkillsSettings
  context?: ContextSettings
  systemPrompt?: string | SystemPromptResolver
  /** SDK local options: settings source for SKILL.md discovery (EC-1) + per-run cwd (V4-L.2). */
  local?: { settingSources?: string[]; cwd?: string }
  /** #89 — `@MCP` servers forwarded to `Agent.create({ mcpServers })` (the SDK owns execution). */
  mcpServers?: McpServersMap
}

/**
 * Project the M8 fields from `CompiledAgentOptions` into `Agent.create()` arguments. Only the async
 * `@ProjectContext` resolver is built here (it does I/O, so the compiler keeps it raw). `applied`
 * lists which decorators contributed, for the observability log (wiring triad — runtime metric).
 */
export function assembleM8CreateOptions(compiled: CompiledAgentOptions): {
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
  // #89 — forward the compiled `@MCP` servers to `Agent.create`. Without this the decorator was
  // inert (metadata compiled but never reaching the SDK runtime — same class as the HITL
  // `kind:'general'` bug). The SDK owns MCP server execution; this is pure adapter projection.
  if (compiled.mcpServers && Object.keys(compiled.mcpServers).length > 0) {
    options.mcpServers = compiled.mcpServers
    applied.push('mcpServers')
  }

  return { options, applied }
}

/**
 * V4-N.1: build the terminal `done` event from the SDK `RunResult` (real per-run token usage +
 * cost). Extracted from the stream generator to keep its complexity within budget (G6).
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
