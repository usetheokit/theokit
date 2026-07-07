/**
 * M30 (ADR-0041) — MCP Apps: `ui://` HTML resources for the MCP server (M16).
 *
 * A tool can declare a `ui://` HTML resource; the MCP server advertises it via `resources/list` and
 * serves the HTML via `resources/read`. The client renders it in a SANDBOXED iframe (see
 * `mcp-app-host.ts`). Pure data transforms here — no LLM, no runtime (ADR-0040 § D2 home concern).
 *
 * Security: only the `ui://` scheme is accepted (an app UI resource), never `http(s)://` — the HTML
 * is rendered sandboxed on the client, and the scheme gate keeps a tool from smuggling a remote URL
 * into the app surface.
 */

/** A declared `ui://` app resource. */
export interface AppResource {
  uri: string
  name: string
  mimeType: 'text/html'
  html: string
  description?: string
}

/** Input to {@link defineAppResource}. */
export interface AppResourceInput {
  /** MUST start with `ui://`. */
  uri: string
  name: string
  html: string
  description?: string
}

/** An MCP `resources/list` descriptor (no HTML body — that comes from `resources/read`). */
export interface McpResourceDescriptor {
  uri: string
  name: string
  mimeType: 'text/html'
  description?: string
}

/** An MCP `resources/read` result. */
export interface McpResourceContents {
  contents: { uri: string; mimeType: 'text/html'; text: string }[]
}

/**
 * Declare a `ui://` HTML app resource. Fails fast if the uri is not a `ui://` scheme or the HTML is
 * empty (error-handling.md) — a misconfigured resource is caught at definition time.
 */
export function defineAppResource(input: AppResourceInput): AppResource {
  if (!input.uri.startsWith('ui://')) {
    throw new Error(
      `defineAppResource: uri must use the ui:// scheme (an app UI resource). Got: ${JSON.stringify(input.uri)}`,
    )
  }
  if (input.html.length === 0) {
    throw new Error(`defineAppResource(${JSON.stringify(input.uri)}): html must be non-empty.`)
  }
  return {
    uri: input.uri,
    name: input.name,
    mimeType: 'text/html',
    html: input.html,
    ...(input.description !== undefined ? { description: input.description } : {}),
  }
}

/** Map app resources to MCP `resources/list` descriptors (the HTML body is omitted from the list). */
export function buildResourceDescriptors(
  resources: readonly AppResource[],
): McpResourceDescriptor[] {
  return resources.map((r) => ({
    uri: r.uri,
    name: r.name,
    mimeType: r.mimeType,
    ...(r.description !== undefined ? { description: r.description } : {}),
  }))
}

/** Serve the HTML for `uri` as an MCP `resources/read` result, or `null` when unknown. */
export function readAppResource(
  resources: readonly AppResource[],
  uri: string,
): McpResourceContents | null {
  const found = resources.find((r) => r.uri === uri)
  if (!found) return null
  return { contents: [{ uri: found.uri, mimeType: 'text/html', text: found.html }] }
}

/** True when `v` is a well-formed {@link AppResource} (from `defineAppResource`). */
function isAppResource(v: unknown): v is AppResource {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.uri === 'string' &&
    r.uri.startsWith('ui://') &&
    r.mimeType === 'text/html' &&
    typeof r.html === 'string'
  )
}

/**
 * M30 wiring — extract the App resources an agent module declares via a named `appResources` export
 * (`export const appResources = [defineAppResource(...)]`). Returns only the well-formed entries; a
 * module without the export (or with a malformed one) yields `[]`. This is how per-agent `ui://`
 * resources reach the MCP server's `resources/list` + `resources/read` without a runtime dependency
 * from `@theokit/agents` on this theo-side type (the module exports them; the serving path reads them).
 */
export function extractAppResources(mod: unknown): AppResource[] {
  const raw = (mod as { appResources?: unknown } | null | undefined)?.appResources
  if (!Array.isArray(raw)) return []
  return raw.filter(isAppResource)
}
