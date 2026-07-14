/**
 * M2 (theokit-ai-first) — `defineAgent`, the zero-config imperative agent surface.
 *
 * ADR-B1: `defineAgent({...})` (default-exported from a top-level `agents/<name>.ts`) is
 * the canonical zero-config surface; the `@Agent` class decorator stays the advanced/DI
 * surface. Both compile to {@link CompiledAgentOptions} and run through the same SDK
 * runtime (`createSdkAgentStream`) — one runtime, two syntaxes.
 *
 * This module is PURE metadata (sdk-runtime.md / G2): `defineAgent` describes an agent, it
 * NEVER calls an LLM. It imports only `zod` (types) + the compiler shape — no `theokit`
 * core, preserving the agents → (nothing) dependency direction (G1).
 */
import type {
  ConversationStorageAdapter,
  CustomTool,
  InlineSkill,
  SettingSource,
} from '@theokit/sdk'
import type { z } from 'zod'

import type { HumanInTheLoopOptions } from '../decorators/human-in-the-loop.js'
import type { Guardrail } from '../guardrails/index.js'
import type { SkillsSelection } from '../skills-resolver.js'
import type { ReasoningEffort } from '../types.js'

import type { CompiledAgentOptions, CompiledTool } from './agent-compiler.js'

/**
 * Brand tag for a `defineAgent` value. `Symbol.for` (global registry, not `Symbol()`) so
 * the brand survives duplicate module instances (dual-package / bundling) — the scanner's
 * brand-check then works regardless of which copy created the definition.
 */
export const AGENT_BRAND: unique symbol = Symbol.for('theokit.agent.definition')

/** Config accepted by {@link defineAgent}. */
export interface DefineAgentConfig<TInput extends z.ZodType = z.ZodType> {
  /** Zod schema for the request body — lifted into the typed client (M2, {@link InferAgentInput}). */
  input?: TInput
  /** Model id (e.g. `claude-sonnet-4-6`). Falls back to the SDK default when omitted. */
  model?: string
  /** Static system prompt. */
  system?: string
  /** Extended-thinking effort (mirrors `@Agent({ reasoningEffort })`). */
  reasoningEffort?: ReasoningEffort
  /**
   * Pre-built tools. Accepts the `@theokit/sdk` `CustomTool` that `defineAgentTool`
   * (theokit/server) and every `@theokit/sdk-tools` factory return (issue #81) — they are
   * normalized to the internal {@link CompiledTool} shape at compile time.
   */
  tools?: readonly CustomTool[]
  /**
   * M7 — run-context: an opaque, per-agent object forwarded to every tool handler's
   * `ctx.context` at run time (injected by the theokit adapter's tool wrapper). Set shared config
   * (e.g. `{ projectRoot }`) ONCE at the agent level instead of baking it into each tool
   * factory. Mirrors ai-sdk `experimental_context`, mastra `RuntimeContext`, and
   * openai-agents-js `RunContext`. Distinct from `@Agent`'s context-window `context`.
   */
  context?: Record<string, unknown>
  /**
   * M9 — guardrails: input/output guards applied at the framework boundary (ADR-0040 § D2).
   * Input guards run on the user message before the SDK runtime; a `block` fails the run fast.
   * Built-ins live in `@theokit/agents` (`promptInjectionDetector`, `piiDetector`, `costGuard`,
   * `unicodeNormalizer`, `outputModeration`).
   */
  guardrails?: readonly Guardrail[]
  /**
   * M14 — HITL approvals keyed by tool name. Each gated tool pauses the run and emits an
   * `approval_required` event until approved (reuses the same `compiled.hitl` wiring the `@Agent`
   * + `@HumanInTheLoop` path produces). A key that does not match a declared tool fails fast at
   * compile time.
   */
  approvals?: Record<string, HumanInTheLoopOptions>
  /**
   * M13 — skills selection: a static list (compiled straight to the SDK `skills.enabled`) OR a
   * per-request resolver `(ctx) => string[]` (carried on `compiled.skillsResolver`, resolved by the
   * request path against the run-context). Absent ⇒ the SDK enables every discovered skill.
   */
  skills?: SkillsSelection
  /**
   * Conversation memory: the `ConversationStorageAdapter` the agent persists its turns to. Swap it to
   * control WHERE memory lives — `InMemoryConversationStorage` (ephemeral, great for tests) vs
   * `FileSystemConversationStorage` (durable) vs a custom adapter. Absent ⇒ the SDK picks its default
   * store. A per-run override still wins over this agent-level default.
   */
  conversationStorage?: ConversationStorageAdapter
  /**
   * theokit-file-based-config — opt into `.theokit/` file-based config (skills, subagents, hooks,
   * MCP, context, cron). The SDK discovers config from these roots under the app's `cwd`:
   * `"project"` = `<cwd>/.theokit/`, `"user"` = `~/.theokit/`. Absent ⇒ inline (code) config only.
   * SECURITY: enabling `"project"` enables shell-executing hooks from `.theokit/hooks.json` — this
   * is opt-in because `.theokit/` is the app's own repo (informed consent). The SDK owns discovery
   * + execution (G2 / ADR-0040); theokit only wires this into `Agent.create({ local.settingSources })`.
   */
  settingSources?: readonly SettingSource[]
}

/**
 * A branded agent definition — the value {@link defineAgent} returns.
 *
 * `TTools` (M8) is a phantom type parameter carrying the tool-name union: the `agent()` builder
 * threads its accumulated literal tool names here (`.build()` returns `AgentDefinition<TInput,
 * 'a' | 'b'>`), so the generated client (`.theokit/agents.d.ts`) can expose them via
 * {@link InferAgentToolNames}. `defineAgent` leaves it `string` (its tools array carries no literal
 * names). Never present at runtime.
 */
export type AgentDefinition<
  TInput extends z.ZodType = z.ZodType,
  TTools extends string = string,
> = DefineAgentConfig<TInput> & {
  readonly [AGENT_BRAND]: true
  readonly __toolNames?: TTools
}

/** Infer the request type of an agent definition from its `input` Zod schema. */
export type InferAgentInput<T> =
  T extends AgentDefinition<infer S> ? (S extends z.ZodType ? z.infer<S> : never) : never

/**
 * Infer the tool-name union of an agent definition (M8). Yields the literal union for agents built
 * with the `agent()` builder (`'read_file' | 'count_lines'`), or `string` for `defineAgent` agents
 * whose tools array carries no literal names.
 */
export type InferAgentToolNames<T> = T extends AgentDefinition<z.ZodType, infer N> ? N : never

/**
 * Define a zero-config agent. Identity/normalizer (like `defineRoute`) — returns the config
 * branded so the scanner recognizes it. Compilation is deferred to {@link compileAgentDefinition}.
 */
export function defineAgent<TInput extends z.ZodType = z.ZodType>(
  config: DefineAgentConfig<TInput>,
): AgentDefinition<TInput> {
  return { ...config, [AGENT_BRAND]: true }
}

/** Brand-check: is `value` a {@link defineAgent} result? */
export function isAgentDefinition(value: unknown): value is AgentDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as unknown as Record<PropertyKey, unknown>)[AGENT_BRAND] === true
  )
}

/**
 * Normalize a pre-built `@theokit/sdk` {@link CustomTool} to the internal
 * {@link CompiledTool} shape (issue #81). `CustomTool.handler` takes a narrower
 * `Record<string, unknown>` input than `CompiledTool.handler`'s `unknown`, so it cannot be
 * assigned directly (contravariance); this thin wrapper bridges the parameter. Runtime-safe:
 * the SDK always calls a tool handler with the parsed input object.
 */
function toCompiledTool(tool: CustomTool): CompiledTool {
  // M7 — forward the run-context `ctx` (2nd arg) to the underlying tool so `defineAgent({ context })`
  // reaches `ctx.context` in the handler (dropping it silently severs the context seam).
  // `CustomTool.handler` takes `Record<string, unknown>` as input; `CompiledTool.handler` takes the
  // wider `unknown`. Contravariance on the input parameter prevents direct assignment — `as unknown as`
  // is the SDK-boundary seam for this widening. Runtime-safe: SDK always passes a plain object for input.
  const handler = tool.handler as unknown as (
    input: unknown,
    ctx?: { signal?: AbortSignal; context?: unknown },
  ) => string | Promise<string>
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: (input, ctx) => handler(input, ctx),
  }
}

/**
 * Lower a definition to the SDK-ready {@link CompiledAgentOptions} — the same shape
 * `compileAgent` (decorator path) produces, so both surfaces converge on one runtime.
 */
export function compileAgentDefinition(def: AgentDefinition): CompiledAgentOptions {
  return {
    model: def.model,
    reasoningEffort: def.reasoningEffort,
    systemPrompt: def.system,
    tools: (def.tools ?? []).map(toCompiledTool),
    agents: {},
    stream: true,
    // M7 — run-context flows to CompiledAgentOptions.runContext (distinct from the
    // context-window `context` field the decorator path uses); absent ⇒ no key.
    ...(def.context !== undefined ? { runContext: def.context } : {}),
    // M9 — guardrails flow through unchanged; the runner applies them at the input boundary.
    ...(def.guardrails !== undefined ? { guardrails: def.guardrails } : {}),
    // M14 — HITL approvals compile into the same `hitl` map the decorator path produces.
    ...(def.approvals !== undefined ? { hitl: compileApprovals(def) } : {}),
    // M13 — skills: a static list → SDK skills.enabled; a resolver → carried for the request path.
    ...compileSkillsSelection(def.skills),
    // Conversation memory: the declared adapter flows to the run path, which hands it to
    // `Agent.getOrCreate({ conversationStorage })`; absent ⇒ the SDK default is chosen lazily.
    ...(def.conversationStorage !== undefined
      ? { conversationStorage: def.conversationStorage }
      : {}),
    // theokit-file-based-config — the declared `.theokit/` sources flow to the run path, which
    // projects them into `Agent.create({ local.settingSources })`; absent ⇒ inline config only.
    ...(def.settingSources !== undefined ? { settingSources: def.settingSources } : {}),
  }
}

/**
 * M13 — split a {@link SkillsSelection} into the compiled fields (static → `skills`, fn →
 * `skillsResolver`). A static array may mix filesystem skill NAMES (`string` → `skills.enabled`) with
 * inline `createSkill` objects (`InlineSkill` → `skills.inline`, injected into the `<skills>` block).
 */
function compileSkillsSelection(
  skills: SkillsSelection | undefined,
): Pick<CompiledAgentOptions, 'skills' | 'skillsResolver'> {
  if (skills === undefined) return {}
  if (typeof skills === 'function') return { skillsResolver: skills }
  const enabled: string[] = []
  const inline: InlineSkill[] = []
  for (const entry of skills) {
    if (typeof entry === 'string') enabled.push(entry)
    else inline.push(entry)
  }
  return {
    skills: { enabled, autoInject: true, ...(inline.length > 0 ? { inline } : {}) },
  }
}

/**
 * Build the HITL gate map from `defineAgent({ approvals })`, keyed by tool name — the same shape
 * `agent-endpoint.ts` consumes. Fails fast (error-handling.md) if an approval names a tool the
 * agent does not declare, so a typo is caught at compile time, not silently ignored at runtime.
 */
function compileApprovals(def: AgentDefinition): Map<string, HumanInTheLoopOptions> {
  const toolNames = new Set((def.tools ?? []).map((t) => t.name))
  const gates = new Map<string, HumanInTheLoopOptions>()
  for (const [toolName, options] of Object.entries(def.approvals ?? {})) {
    if (!toolNames.has(toolName)) {
      throw new Error(
        `[@theokit/agents] defineAgent approval references unknown tool "${toolName}". ` +
          `Declared tools: ${[...toolNames].join(', ') || '(none)'}.`,
      )
    }
    gates.set(toolName, options)
  }
  return gates
}
