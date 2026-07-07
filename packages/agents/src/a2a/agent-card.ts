/**
 * M15 (theokit-ai-first) — A2A agent card generation (ADR-0040 § D2, home/discovery concern).
 *
 * Produces an [A2A](https://github.com/google/A2A)-spec Agent Card from the framework's
 * `AgentManifestEntry`, so other systems can discover a TheoKit agent's capabilities over HTTP at
 * `/.well-known/<name>/agent-card.json`. Pure data transform — no LLM, no runtime (G2).
 */
import type { AgentManifestEntry } from '../manifest/agent-manifest.js'

/** A single capability exposed by an A2A agent (maps from a TheoKit tool). */
export interface A2ASkill {
  id: string
  name: string
  description: string
}

/** A2A agent-card capabilities block. */
export interface A2ACapabilities {
  streaming: boolean
  pushNotifications: boolean
  stateTransitionHistory: boolean
}

/** An A2A-spec Agent Card (the subset TheoKit advertises). */
export interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  capabilities: A2ACapabilities
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: A2ASkill[]
}

export interface BuildAgentCardOptions {
  /** Absolute base URL of the deployment (e.g. `https://app.example.com`). A trailing slash is trimmed. */
  baseUrl: string
  /** Human description of the agent. Defaults to a generated sentence when omitted (spec requires non-empty). */
  description?: string
}

/** Strip a single trailing slash so `${baseUrl}${route}` never doubles the separator. */
function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/** Build an A2A agent card from a manifest entry. */
export function buildAgentCard(entry: AgentManifestEntry, options: BuildAgentCardOptions): AgentCard {
  const base = trimTrailingSlash(options.baseUrl)
  return {
    name: entry.name,
    description: options.description ?? `TheoKit agent "${entry.name}".`,
    url: `${base}${entry.route}`,
    version: '1.0',
    capabilities: {
      streaming: entry.stream,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: entry.tools.map((t) => ({ id: t.name, name: t.name, description: t.description })),
  }
}

/** The A2A discovery path for an agent: `/.well-known/<name>/agent-card.json`. */
export function wellKnownCardPath(agentName: string): string {
  return `/.well-known/${agentName}/agent-card.json`
}
