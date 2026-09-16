import { ConfigError, ENV_BY_KEY, type SchemaKey } from './config.js'

const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

function coerce(leaf: string, raw: string): unknown {
  return ENV_BY_KEY[leaf as SchemaKey]?.coerce(raw) ?? raw
}

function requireUsablePath(pair: string, path: readonly string[]): void {
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

function descendCreating(
  root: Record<string, unknown>,
  path: readonly string[],
  pair: string,
): Record<string, unknown> {
  let node = root
  for (const segment of path.slice(0, -1)) {
    const next = node[segment]
    if (next === undefined) {
      const created: Record<string, unknown> = {}
      node[segment] = created
      node = created
    } else if (typeof next === 'object' && next !== null && !Array.isArray(next)) {
      node = next as Record<string, unknown>
    } else {
      throw new ConfigError(
        `-c ${pair}: \`${segment}\` was already set as a value on this same command line`,
      )
    }
  }
  return node
}

export function cliOverridesLayer(pares: readonly string[]): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  for (const pair of pares) {
    const splitAt = pair.indexOf('=')
    if (splitAt < 0) {
      throw new ConfigError(
        `-c ${pair}: expected \`key=value\` (or \`key.nested=value\`); with no equals sign there is no value to apply`,
      )
    }
    const path = pair.slice(0, splitAt).split('.')
    const raw = pair.slice(splitAt + 1)
    requireUsablePath(pair, path)
    const node = descendCreating(root, path, pair)
    const leaf = path[path.length - 1]!
    const existing = node[leaf]
    if (typeof existing === 'object' && existing !== null) {
      throw new ConfigError(
        `-c ${pair}: \`${leaf}\` was already built as a branch on this same command line — ` +
          `overwriting it would yield an object matching neither of the two pairs written`,
      )
    }
    node[leaf] = coerce(leaf, raw)
  }
  return root
}
