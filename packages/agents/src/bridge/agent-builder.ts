/**
 * M8 — `agent()`, the fluent agent builder with accumulative **type-state**.
 *
 * `agent().context<C>().tool(t).model(id).system(s).build()` accumulates type parameters the way
 * the most-loved TS DX does (tRPC `t.procedure.input().query()`, Zod, Hono) and resolves to the
 * **SAME branded `AgentDefinition`** that {@link defineAgent} produces — one runtime, N syntaxes
 * (ADR-B1). The value is entirely at the type level; `.build()` delegates to `defineAgent`, so
 * convergence with the `defineAgent` / `@Agent` surfaces is by construction.
 *
 * Compile-time guarantees (proven by `tests/type/agent-builder.test-d.ts`):
 * - `.build()` is a compile error when `.model()` was never called (UnsetMarker technique — tRPC
 *   `utils.ts:2-4` / `procedureBuilder.ts:362-379`).
 * - `.tool(t)` is a compile error when the tool declares a required run-context ⊄ the agent's `C`.
 * - tool names accumulate into a union type parameter (`TTools`).
 *
 * PURE metadata (sdk-runtime.md / G2): the builder describes an agent, it NEVER calls an LLM.
 */
import type { CustomTool, SettingSource } from '@theokit/sdk'
import type { z } from 'zod'

import type { HumanInTheLoopOptions } from '../decorators/human-in-the-loop.js'
import type { McpServersMap } from '../decorators/mcp.js'
import type { Guardrail } from '../guardrails/index.js'
import type { SkillsSelection } from '../skills-resolver.js'
import type { ReasoningEffort } from '../types.js'

import { defineAgent, type AgentDefinition, type DefineAgentConfig } from './define-agent.js'

/**
 * A required-but-unset builder field. Branded (a literal intersected with a unique brand) so no
 * ordinary value can satisfy it — the terminal-method guards below key off it. tRPC's UnsetMarker.
 */
type UnsetMarker = 'theokit.unset' & { readonly __brand: 'theokit.unset' }

/**
 * Compile-error carriers. When a guarded method's precondition fails, its signature demands an
 * argument of one of these types, which the caller cannot supply — the labeled tuple element
 * surfaces the reason in the error. (Idiomatic gate for zero-arg terminal methods.)
 */
interface MissingModelError {
  readonly __theokitError: 'call .model(id) before .build()'
}
interface ToolContextError<TRequired> {
  readonly __theokitError: 'this tool requires a run-context not provided via .context()'
  readonly required: TRequired
}

/** The agent context before `.context()` is called — satisfies only tools with no requirement. */
type EmptyContext = Record<never, never>

/**
 * A tool that MAY declare, at the type level, the run-context shape it needs. A plain
 * {@link CustomTool} (`TRequired = unknown`) is satisfied by any agent context. Build one that
 * carries a literal name + optional required-context via {@link contextualTool}.
 */
export interface ContextualTool<
  TName extends string = string,
  TRequired = unknown,
> extends CustomTool {
  readonly name: TName
  /** Phantom — never present at runtime; carries the required run-context type for `.tool()`. */
  readonly __requiredContext?: TRequired
}

/**
 * Tag a {@link CustomTool} with a literal name (so `.tool()` can accumulate the tool-name union)
 * and, optionally, a required run-context type. The `requiredContext` argument is a type-only
 * witness — pass `undefined as C` or a sample value; it is never read at runtime.
 */
export function contextualTool<TName extends string, TRequired = unknown>(
  tool: CustomTool & { name: TName },
  _requiredContext?: TRequired,
): ContextualTool<TName, TRequired> {
  return tool
}

/**
 * The fluent builder. Each method returns a NEW builder type with the relevant type parameter
 * advanced (immutable chaining). Runtime state is a plain {@link DefineAgentConfig} accumulator.
 */
export interface AgentBuilder<
  TInput extends z.ZodType | UnsetMarker = UnsetMarker,
  TModel extends string | UnsetMarker = UnsetMarker,
  TContext = EmptyContext,
  TTools extends string = never,
> {
  /** Set the request schema (lifted into the typed client via {@link AgentDefinition}). */
  input<S extends z.ZodType>(schema: S): AgentBuilder<S, TModel, TContext, TTools>
  /**
   * Set the model id. Required before `.build()`. COMPILE ERROR when called twice — the argument
   * type collapses to `never` once the model is set (tRPC's set-once technique).
   */
  model(
    id: TModel extends UnsetMarker ? string : never,
  ): AgentBuilder<TInput, string, TContext, TTools>
  /** Set the static system prompt. */
  system(prompt: string): AgentBuilder<TInput, TModel, TContext, TTools>
  /** Set the extended-thinking effort. */
  reasoningEffort(effort: ReasoningEffort): AgentBuilder<TInput, TModel, TContext, TTools>
  /** Set the run-context (M7) — the object every tool handler receives as `ctx.context`. */
  context<C extends Record<string, unknown>>(value: C): AgentBuilder<TInput, TModel, C, TTools>
  /**
   * Add a tool. Accumulates its name into `TTools`. COMPILE ERROR when the tool declares a
   * required run-context (`ContextualTool<_, TRequired>`) that the agent's `TContext` does not
   * satisfy — set it first with `.context()`.
   */
  tool<TName extends string, TRequired>(
    tool: ContextualTool<TName, TRequired>,
    ...guard: TContext extends TRequired ? [] : [error: ToolContextError<TRequired>]
  ): AgentBuilder<TInput, TModel, TContext, TTools | TName>
  /** M9 — add one input/output guardrail (appends). Runs at the framework boundary before the SDK. */
  guardrail(g: Guardrail): AgentBuilder<TInput, TModel, TContext, TTools>
  /** M9 — set the full guardrail list (replaces any previously added). */
  guardrails(gs: readonly Guardrail[]): AgentBuilder<TInput, TModel, TContext, TTools>
  /** M14 — gate one tool behind a HITL approval (merges into the approvals map, keyed by tool name). */
  approval(
    toolName: TTools extends never ? string : TTools,
    options: HumanInTheLoopOptions,
  ): AgentBuilder<TInput, TModel, TContext, TTools>
  /** M14 — set the full approvals map (replaces any previously added). */
  approvals(
    map: Record<string, HumanInTheLoopOptions>,
  ): AgentBuilder<TInput, TModel, TContext, TTools>
  /**
   * M13 — the skills the agent can consult mid-turn: a static list OR a per-request
   * resolver `(ctx) => string[]`. Each entry is a `createSkill(...)` object OR a
   * filesystem skill NAME (a string) — mix freely.
   *
   * Progressive disclosure (cheap by default): every turn the SDK lists each skill's
   * name + description in a `<skills>` block (so the model KNOWS the skill exists) AND
   * auto-provisions a `skill_read` tool the model calls to load the full body ON DEMAND
   * (so a long procedure only enters the prompt when it is actually needed).
   */
  skills(selection: SkillsSelection): AgentBuilder<TInput, TModel, TContext, TTools>
  /**
   * theokit-file-based-config — opt into `.theokit/` file-based config (skills, subagents, hooks,
   * MCP, context, cron), discovered by the SDK from the app root (`"project"` = `<cwd>/.theokit/`,
   * `"user"` = `~/.theokit/`). Unset ⇒ inline (code) config only. SECURITY: `"project"` enables
   * shell-executing hooks from `.theokit/hooks.json` — opt-in because `.theokit/` is your own repo.
   */
  settingSources(sources: readonly SettingSource[]): AgentBuilder<TInput, TModel, TContext, TTools>
  /**
   * Attach LIFECYCLE HOOKS in code, keyed by `HookName` — the builder-chain seam for intercepting
   * the agent loop. `pre_tool_call` may VETO a tool by returning `{ block: true, message }` before
   * it runs; the other events are observational.
   *
   * ```ts
   * agent().hooks({
   *   pre_tool_call: (c) => guard(c.name) ? undefined : { block: true, message: 'not allowed' },
   *   on_session_start: () => log('session up'),
   * })
   * ```
   *
   * A hook is delivered internally as a code plugin, but that is TRANSPORT, not the contract — use
   * this instead of hand-wrapping a plugin, so the caller expresses interception rather than
   * assembling plumbing. Call once — a later call replaces the map. Composes with
   * {@link AgentBuilder.plugins}: hooks and plugins are additive, not exclusive.
   */
  hooks(map: Readonly<Record<string, unknown>>): AgentBuilder<TInput, TModel, TContext, TTools>
  /**
   * Register code `Plugin` objects for this agent — the builder-chain equivalent of
   * `Agent.create({ plugins })`. A plugin is an EXTENSION UNIT: it can register tools and commands,
   * or supply a model provider / memory adapter (`kind: 'general' | 'model-provider' | 'memory'`).
   *
   * For lifecycle interception prefer {@link AgentBuilder.hooks} — a hook needs a plugin only as its
   * transport, and `plugins()` makes the caller assemble that transport by hand. Reach for this when
   * you genuinely have a plugin (a provider, a memory adapter, a tool-registering extension).
   */
  plugins(list: readonly unknown[]): AgentBuilder<TInput, TModel, TContext, TTools>
  /**
   * Declare MCP (Model Context Protocol) servers available to this agent — the builder-chain
   * equivalent of the `@MCP` class decorator. Each key is a server name; the value is its config
   * (`command` / `args` / `env` / `cwd`). Forwarded to `Agent.create({ mcpServers })`; the SDK owns
   * MCP execution. Call once — a later call replaces the map.
   */
  mcp(servers: McpServersMap): AgentBuilder<TInput, TModel, TContext, TTools>
  /**
   * Apply a reusable partial chain (Spring-Boot-style composition). `preset` receives the current
   * builder and returns an advanced one; its accumulated type-state flows through.
   */
  use<TResult>(
    preset: (builder: AgentBuilder<TInput, TModel, TContext, TTools>) => TResult,
  ): TResult
  /**
   * Resolve to the branded {@link AgentDefinition} — the SAME value `defineAgent` returns.
   * COMPILE ERROR when `.model()` was never called.
   */
  build(
    ...guard: TModel extends UnsetMarker ? [error: MissingModelError] : []
  ): AgentDefinition<TInput extends z.ZodType ? TInput : z.ZodType, TTools>
  /** Phantom — lets type tests read the accumulated tool-name union. Never present at runtime. */
  readonly __toolNames?: TTools
}

/**
 * Build the runtime accumulator. The public method signatures carry the type-state generics + the
 * compile-time guards; the runtime cannot track generics, so the object is bridged to the typed
 * interface once here (the single, documented type-state impl seam — same technique tRPC uses).
 */
function makeBuilder(config: DefineAgentConfig): AgentBuilder {
  const runtime = {
    input: (schema: z.ZodType) => makeBuilder({ ...config, input: schema }),
    model: (id: string) => makeBuilder({ ...config, model: id }),
    system: (prompt: string) => makeBuilder({ ...config, system: prompt }),
    reasoningEffort: (effort: ReasoningEffort) =>
      makeBuilder({ ...config, reasoningEffort: effort }),
    context: (value: Record<string, unknown>) => makeBuilder({ ...config, context: value }),
    tool: (tool: CustomTool) => makeBuilder({ ...config, tools: [...(config.tools ?? []), tool] }),
    guardrail: (g: Guardrail) =>
      makeBuilder({ ...config, guardrails: [...(config.guardrails ?? []), g] }),
    guardrails: (gs: readonly Guardrail[]) => makeBuilder({ ...config, guardrails: gs }),
    approval: (toolName: string, options: HumanInTheLoopOptions) =>
      makeBuilder({ ...config, approvals: { ...(config.approvals ?? {}), [toolName]: options } }),
    approvals: (map: Record<string, HumanInTheLoopOptions>) =>
      makeBuilder({ ...config, approvals: map }),
    skills: (selection: SkillsSelection) => makeBuilder({ ...config, skills: selection }),
    settingSources: (sources: readonly SettingSource[]) =>
      makeBuilder({ ...config, settingSources: sources }),
    hooks: (map: Readonly<Record<string, unknown>>) => makeBuilder({ ...config, hooks: map }),
    plugins: (list: readonly unknown[]) => makeBuilder({ ...config, plugins: list }),
    mcp: (servers: McpServersMap) => makeBuilder({ ...config, mcpServers: servers }),
    use: (preset: (b: unknown) => unknown) => preset(runtime),
    build: () => defineAgent(config),
  }
  return runtime as unknown as AgentBuilder
}

/**
 * Start a fluent agent definition. Chain `.model()` (required) + `.context()` / `.system()` /
 * `.input()` / `.tool()` / `.use()`, then `.build()` to get the branded {@link AgentDefinition}.
 */
export function agent(): AgentBuilder {
  return makeBuilder({})
}
