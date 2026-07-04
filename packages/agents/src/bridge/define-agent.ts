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
import type { z } from 'zod'

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
  /** Pre-built tools (SDK-ready `CompiledTool` shape). */
  tools?: CompiledTool[]
}

/** A branded agent definition — the value {@link defineAgent} returns. */
export type AgentDefinition<TInput extends z.ZodType = z.ZodType> = DefineAgentConfig<TInput> & {
  readonly [AGENT_BRAND]: true
}

/** Infer the request type of an agent definition from its `input` Zod schema. */
export type InferAgentInput<T> =
  T extends AgentDefinition<infer S> ? (S extends z.ZodType ? z.infer<S> : never) : never

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
    (value as Record<PropertyKey, unknown>)[AGENT_BRAND] === true
  )
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
    tools: def.tools ?? [],
    agents: {},
    stream: true,
  }
}
