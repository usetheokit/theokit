import { auditEnvReachability } from '@theokit/sdk'
import type { EnvOptOut, EnvReachabilityAudit } from '@theokit/sdk'

export type EnvKnobKind = 'string' | 'boolean' | 'number'

/** One config key that the environment may set: the variable that carries it and how to read it. */
export interface EnvKnob {
  readonly variable: string
  readonly kind: EnvKnobKind
}

export function envKnob(variable: string, kind: EnvKnobKind): EnvKnob {
  return { variable, kind }
}

const TRUE_WORDS = new Set(['1', 'true', 'yes', 'on'])
const FALSE_WORDS = new Set(['0', 'false', 'no', 'off'])

/**
 * Coerce one raw variable value. An unrecognised value is returned verbatim, never read as `false`,
 * so the schema that validates the layer rejects it by key name.
 */
export function coerceEnvValue(raw: string, kind: EnvKnobKind): unknown {
  if (kind === 'boolean') {
    const word = raw.trim().toLowerCase()
    if (TRUE_WORDS.has(word)) return true
    if (FALSE_WORDS.has(word)) return false
    return raw
  }
  if (kind === 'number') {
    // `Number('')` is 0, so a blank value must not reach it.
    if (raw.trim() === '') return raw
    const n = Number(raw)
    return Number.isFinite(n) ? n : raw
  }
  return raw
}

/** The env layer: only keys whose variable is set, coerced. Validation stays with the schema. */
export function envLayerFrom(
  env: Readonly<Record<string, string | undefined>>,
  knobs: Readonly<Record<string, EnvKnob>>,
): Record<string, unknown> {
  const layer: Record<string, unknown> = {}
  for (const [key, knob] of Object.entries(knobs)) {
    const raw = env[knob.variable]
    if (raw === undefined) continue
    layer[key] = coerceEnvValue(raw, knob.kind)
  }
  return layer
}

/** Every key must have a knob or a documented opt-out; delegates to the SDK's audit. */
export function auditEnvKnobs(input: {
  readonly keys: readonly string[]
  readonly knobs: Readonly<Record<string, EnvKnob>>
  readonly optOuts: readonly EnvOptOut[]
}): EnvReachabilityAudit {
  return auditEnvReachability({
    keys: input.keys,
    reachable: Object.keys(input.knobs),
    optOuts: input.optOuts,
  })
}
