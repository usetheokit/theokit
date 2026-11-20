import { DottedOverrideError, coerceEnvValue, parseDottedOverrides } from '@theokit/agents/config'

import { ConfigError, ENV_BY_KEY, type SchemaKey } from './config.js'

const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/** The framework parses `-c a.b=v`; what stays here is the coercion table and this product's wording. */
function wording(pair: string, err: DottedOverrideError): ConfigError {
  const key = pair.includes('=') ? pair.slice(0, pair.indexOf('=')) : pair
  const reserved = key.split('.').find((s) => RESERVED_SEGMENTS.has(s))
  if (reserved !== undefined) {
    return new ConfigError(
      `-c ${pair}: \`${reserved}\` is a reserved object-prototype segment and cannot be a ` +
        `config key — writing it would alter \`Object.prototype\` for the whole process, ` +
        `underneath the schema's strict validation`,
    )
  }
  if (!pair.includes('=')) {
    return new ConfigError(
      `-c ${pair}: expected \`key=value\` (or \`key.nested=value\`); with no equals sign there is no value to apply`,
    )
  }
  if (key.split('.').some((s) => s.trim().length === 0)) {
    return new ConfigError(`-c ${pair}: config key path has an empty segment`)
  }
  return new ConfigError(`-c ${pair}: ${err.message}`)
}

export function cliOverridesLayer(pares: readonly string[]): Record<string, unknown> {
  try {
    return parseDottedOverrides(pares, {
      coerce: (path, raw) => {
        const knob = ENV_BY_KEY[path.slice(path.lastIndexOf('.') + 1) as SchemaKey]
        return knob === undefined ? raw : coerceEnvValue(raw, knob.kind)
      },
    })
  } catch (err) {
    if (err instanceof DottedOverrideError) {
      const pair = pares.find((p) => err.message.includes(`"${p}"`)) ?? ''
      throw wording(pair, err)
    }
    throw err
  }
}
