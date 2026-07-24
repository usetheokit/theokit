/**
 * Pure helper: build a devtools-safe body preview from an arbitrary
 * request body value (parsed object, raw string, Uint8Array, etc.).
 *
 * Caps preview at `maxBytes` (default 4 KB) — large bodies still
 * surface a truncated tail so the devtools tab is useful for forms
 * and small JSON; binary uploads degrade to a marker line.
 *
 * Used by `broadcastRequest` to enrich the per-request payload sent
 * to the devtools UI. Pure / side-effect free / no Node-only APIs
 * so it runs in any environment (vitest, Node, Vite SSR, deno, edge).
 *
 * NEVER use dangerouslySetInnerHTML in any devtools component — see plan EC-20.
 */

const DEFAULT_MAX_BYTES = 4096

interface BodyPreview {
  /** Preview string (already truncated to <= maxBytes). */
  readonly preview: string
  /** Total length of the source body in bytes (or chars for strings). */
  readonly length: number
  /** Whether the preview was truncated. */
  readonly truncated: boolean
}

interface BuildBodyPreviewOptions {
  maxBytes?: number
}

export function buildRequestBodyPreview(
  body: unknown,
  options: BuildBodyPreviewOptions = {},
): BodyPreview | undefined {
  if (body === undefined || body === null) return undefined
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  if (typeof body === 'string') {
    return finalize(body, body.length, maxBytes)
  }

  if (body instanceof Uint8Array) {
    return {
      preview: `<binary ${String(body.byteLength)} bytes>`,
      length: body.byteLength,
      truncated: false,
    }
  }

  if (typeof body === 'object') {
    try {
      const json = JSON.stringify(body, null, 2)
      // JSON.stringify returns undefined for some inputs (functions / symbols
      // at top level); falsy/empty-string also unhelpful — surface a marker.
      if (typeof json !== 'string') {
        return { preview: '<unserializable>', length: 0, truncated: false }
      }
      return finalize(json, json.length, maxBytes)
    } catch {
      // Circular reference, BigInt, or other JSON.stringify failure.
      return {
        preview: '<unserializable: circular or non-JSON value>',
        length: 0,
        truncated: false,
      }
    }
  }

  // Primitives only: explicit dispatch keeps this pure (no Object-default
  // [object Object] stringification surprises) and lint-clean.
  if (typeof body === 'number' || typeof body === 'boolean' || typeof body === 'bigint') {
    const s = String(body)
    return finalize(s, s.length, maxBytes)
  }
  if (typeof body === 'symbol') {
    const s = body.toString()
    return finalize(s, s.length, maxBytes)
  }
  // function or any remaining exotic — surface a marker without stringifying.
  return { preview: '<unserializable>', length: 0, truncated: false }
}

function finalize(source: string, totalLength: number, maxBytes: number): BodyPreview {
  if (source.length <= maxBytes) {
    return { preview: source, length: totalLength, truncated: false }
  }
  return { preview: source.slice(0, maxBytes), length: totalLength, truncated: true }
}
