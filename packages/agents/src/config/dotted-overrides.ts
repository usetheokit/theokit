import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * A `-c a.b=value` pair that cannot become a config layer. The message names the pair and the
 * reason and nothing else.
 */
export class DottedOverrideError extends TheokitAgentError {
  override readonly name = 'DottedOverrideError'
  constructor(pair: string, reason: string) {
    super(`config override "${pair}": ${reason}`, {
      code: 'dotted_override_invalid',
      // the same argv fails the same way next time.
      isRetryable: false,
    })
  }
}

const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

type Obj = Record<string, unknown>

function splitKey(pair: string): { key: string; raw: string; segments: string[] } {
  const eq = pair.indexOf('=')
  if (eq < 0) throw new DottedOverrideError(pair, 'expected key=value')
  const key = pair.slice(0, eq)
  const segments = key.split('.')
  if (segments.includes('')) throw new DottedOverrideError(pair, 'empty key segment')
  if (segments.some((s) => RESERVED.has(s))) {
    throw new DottedOverrideError(pair, 'reserved key segment')
  }
  return { key, raw: pair.slice(eq + 1), segments }
}

/**
 * Turns `a.b=value` pairs into one nested config layer, refusing prototype-pollution segments and
 * pairs that build incompatible shapes. Values stay strings unless `coerce` (given the FULL dotted
 * path, not the leaf name) returns something else. A repeated leaf takes the last value.
 */
export function parseDottedOverrides(
  pairs: readonly string[],
  options: { readonly coerce?: (path: string, raw: string) => unknown } = {},
): Record<string, unknown> {
  const root: Obj = {}
  // Paths set as values: a coerced object is still a leaf, so runtime type cannot tell.
  const leaves = new Set<string>()
  const branches = new Set<string>()

  for (const pair of pairs) {
    const { key, raw, segments } = splitKey(pair)
    const parents = segments.slice(0, -1)
    // Validate the whole path before writing anything.
    for (let i = 1; i <= parents.length; i++) {
      if (leaves.has(parents.slice(0, i).join('.'))) {
        throw new DottedOverrideError(pair, 'descends through a key already set as a value')
      }
    }
    if (branches.has(key)) {
      throw new DottedOverrideError(pair, 'would overwrite a nested key with a value')
    }

    const value = options.coerce ? options.coerce(key, raw) : raw

    let node = root
    parents.forEach((seg, i) => {
      if (!hasOwn(node, seg)) node[seg] = {}
      branches.add(parents.slice(0, i + 1).join('.'))
      node = node[seg] as Obj
    })
    node[segments[segments.length - 1]] = value
    leaves.add(key)
  }
  return root
}
