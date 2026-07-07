/**
 * M15 (theokit-ai-first) — serve the A2A agent card at `/.well-known/<name>/agent-card.json`.
 *
 * `buildAgentCard` (@theokit/agents) is the pure generator; this handler compiles a loaded agent
 * module to its tools + streaming capability, builds the card, and returns it as a Web-Standard
 * JSON `Response` (G8). The dev middleware + prod handler branch to this before the agent POST route.
 */
import {
  type AgentManifestEntry,
  buildAgentCard,
  compileAgentModule,
} from '@theokit/agents'

const WELL_KNOWN = /^\/\.well-known\/([^/]+)\/agent-card\.json$/

/** Return the agent name when `urlPath` is a well-known card path, else `null`. */
export function isAgentCardPath(urlPath: string): string | null {
  const match = WELL_KNOWN.exec(urlPath)
  return match ? decodeURIComponent(match[1]) : null
}

/** Build a minimal manifest entry (the subset `buildAgentCard` reads) from a compiled agent. */
function toManifestEntry(name: string, route: string, mod: unknown): AgentManifestEntry {
  const compiled = compileAgentModule(mod, `agent card for "${name}"`)
  return {
    name,
    route,
    stream: compiled.stream,
    mainLoop: { method: '', strategy: '' },
    guards: [],
    interceptors: [],
    tools: compiled.tools.map((t) => ({
      name: t.name,
      description: t.description,
      approval: false,
      trace: false,
      audit: false,
    })),
    subAgents: [],
  }
}

/**
 * Serve the A2A card for a loaded agent module. Returns 200 with the card JSON, or 500 with an
 * error body if the module is not a valid agent (fail-clear, not a silent empty card).
 */
export function handleAgentCard(mod: unknown, name: string, route: string, baseUrl: string): Response {
  try {
    const card = buildAgentCard(toManifestEntry(name, route, mod), { baseUrl })
    return new Response(JSON.stringify(card), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: { code: 'AGENT_CARD_FAILED', message: err instanceof Error ? err.message : 'card build failed' } }),
      { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } },
    )
  }
}
