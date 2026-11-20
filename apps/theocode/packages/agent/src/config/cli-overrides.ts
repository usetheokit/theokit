import { DottedOverrideError, coerceEnvValue, parseDottedOverrides } from '@theokit/agents/config'

import { ConfigError, ENV_BY_KEY, type SchemaKey } from './config.js'

const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

function coerce(path: string, raw: string): unknown {
  const knob = ENV_BY_KEY[path.slice(path.lastIndexOf('.') + 1) as SchemaKey]
  return knob === undefined ? raw : coerceEnvValue(raw, knob.kind)
}

/**
 * The refusals the framework cannot word for this product, checked on one pair before it is handed
 * over: a missing `=`, a blank segment (whitespace included), a prototype segment.
 */
function requireUsablePair(pair: string): void {
  const splitAt = pair.indexOf('=')
  if (splitAt < 0) {
    throw new ConfigError(
      `-c ${pair}: expected \`key=value\` (or \`key.nested=value\`); with no equals sign there is no value to apply`,
    )
  }
  const path = pair.slice(0, splitAt).split('.')
  if (path.some((s) => s.trim().length === 0)) {
    throw new ConfigError(`-c ${pair}: config key path has an empty segment`)
  }
  const reserved = path.find((s) => RESERVED_SEGMENTS.has(s))
  if (reserved !== undefined) {
    throw new ConfigError(
      `-c ${pair}: \`${reserved}\` is a reserved object-prototype segment and cannot be a ` +
        `config key — writing it would alter \`Object.prototype\` for the whole process, ` +
        `underneath the schema's strict validation`,
    )
  }
}

/** The pair's key path, for words about a clash with an earlier pair on the same command line. */
function keyOf(pair: string): string[] {
  return pair.slice(0, pair.indexOf('=')).split('.')
}

/** Words for a structural clash between `pair` and the pairs before it. */
function clash(pair: string, earlier: readonly string[], err: DottedOverrideError): ConfigError {
  const path = keyOf(pair)
  const leaves = new Set(earlier.map((p) => keyOf(p).join('.')))
  for (let i = 1; i < path.length; i++) {
    if (leaves.has(path.slice(0, i).join('.'))) {
      return new ConfigError(
        `-c ${pair}: \`${path[i - 1]}\` was already set as a value on this same command line`,
      )
    }
  }
  const leaf = path[path.length - 1]!
  if (earlier.some((p) => keyOf(p).join('.').startsWith(`${path.join('.')}.`))) {
    return new ConfigError(
      `-c ${pair}: \`${leaf}\` was already built as a branch on this same command line — ` +
        `overwriting it would yield an object matching neither of the two pairs written`,
    )
  }
  return new ConfigError(`-c ${pair}: ${err.message}`)
}

/**
 * `-c a.b=value` pairs as one config layer. The parse, the prototype guard and the clash detection
 * are the framework's `parseDottedOverrides`; the coercion table and every message are this product's.
 * Pairs are fed one prefix at a time so the first one the framework refuses is known by position,
 * not recovered from its message.
 */
export function cliOverridesLayer(pares: readonly string[]): Record<string, unknown> {
  pares.forEach(requireUsablePair)
  for (let i = 0; i < pares.length; i++) {
    try {
      parseDottedOverrides(pares.slice(0, i + 1), { coerce })
    } catch (err) {
      if (err instanceof DottedOverrideError) throw clash(pares[i]!, pares.slice(0, i), err)
      throw err
    }
  }
  return parseDottedOverrides(pares, { coerce })
}
