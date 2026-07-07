/**
 * `@Guardrails([...])` — M9 class-decorator surface for input/output guardrails.
 *
 * The functional `defineAgent({ guardrails: [...] })` path already applies guards at the framework
 * boundary (ADR-0040 § D2). This decorator gives the `@Agent` class path the SAME capability: the
 * declared guards compile into `compiled.guardrails` (via `walkAgentMetadata`), so `AgentRunner`
 * applies them identically. Metadata-only (like `@MCP`/`@Skills`) — it describes, the runner runs.
 *
 * @example
 * ```ts
 * @Agent({ name: 'support', route: '/api/agents/support' })
 * @Guardrails([promptInjectionDetector(), piiDetector({ redact: true })])
 * class SupportAgent {}
 * ```
 */
import type { Guardrail } from '../guardrails/index.js'
import { setMeta, getMeta } from '../metadata/index.js'

const GUARDRAILS_CONFIG = Symbol.for('theokit:agents:guardrails')

export function Guardrails(guardrails: readonly Guardrail[]): ClassDecorator {
  return (target: Function) => {
    setMeta(GUARDRAILS_CONFIG, target, guardrails)
  }
}

export function getGuardrailsConfig(target: Function): readonly Guardrail[] | undefined {
  return getMeta<readonly Guardrail[]>(GUARDRAILS_CONFIG, target)
}
