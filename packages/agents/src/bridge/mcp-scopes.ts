// The personal + project MCP merge that `mcp-file.ts` leaves undone on purpose (B-071).
//
// Two decisions live here and nowhere else: the TRUST GATE (a project's servers are withheld when the
// directory is not trusted) and the CLASH RULE (who wins when both scopes declare one name).

import type { McpServersMap } from '../types.js'

import { loadMcpJson, loadPersonalMcpServers } from './mcp-file.js'

export interface McpScopesResult {
  readonly servers: McpServersMap
  /** Names that came from personal files. */
  readonly personal: readonly string[]
  /** Project names dropped by the trust gate. */
  readonly projectWithheld: readonly string[]
  /** Names declared in both scopes, and which scope kept its server. */
  readonly shadowed: readonly { readonly name: string; readonly winner: 'personal' | 'project' }[]
}

function describeIt(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function loadPersonalSource(
  source: string,
  home: string,
  opts: { onWarn?: (message: string) => void },
): McpServersMap {
  if (source === 'claude-json') return loadPersonalMcpServers(home, opts)
  try {
    return loadMcpJson(source, opts)
  } catch (err) {
    const warn = opts.onWarn ?? ((m: string) => process.stderr.write(`[@theokit/agents] ${m}\n`))
    warn(
      `${source}/.mcp.json could not be read for MCP servers, so none were loaded: ${describeIt(err)}`,
    )
    return {}
  }
}

/**
 * Merge the operator's own MCP servers with the project's `.mcp.json`.
 *
 * - `personalFiles` defaults to `['claude-json']` (`~/.claude.json`); any other string is a directory
 *   holding a `.mcp.json`. When personal files repeat a name, the earlier one wins.
 * - A malformed PROJECT file throws `McpFileError`, because it is the project's own declaration. A
 *   malformed PERSONAL file only warns, because one stray comma in a shared home file must not break
 *   every project on the machine.
 * - When `projectAllowed` is false the project file is parsed only to list its names in
 *   `projectWithheld`; none of its entries reach `servers`. (Names the operator policy already denies
 *   are not listed, since the loader drops them while parsing.)
 * - `onClash` defaults to `'personal-wins'`: a repository must not be able to replace a server the
 *   operator configured. `'project-wins'` matches the reference format.
 */
export function loadMcpScopes(input: {
  readonly cwd: string
  readonly home: string
  /** `'claude-json'` reads `~/.claude.json`; any other string is a directory holding a `.mcp.json`. */
  readonly personalFiles?: readonly string[]
  readonly projectAllowed: boolean
  readonly onClash?: 'personal-wins' | 'project-wins'
  readonly onWarn?: (message: string) => void
}): McpScopesResult {
  const opts = input.onWarn ? { onWarn: input.onWarn } : {}
  const personalMap = new Map<string, McpServersMap[string]>()
  for (const source of input.personalFiles ?? ['claude-json']) {
    const loaded = loadPersonalSource(source, input.home, opts)
    for (const [name, cfg] of Object.entries(loaded)) {
      if (!personalMap.has(name)) personalMap.set(name, cfg)
    }
  }

  const project = loadMcpJson(input.cwd, opts)
  const projectWithheld = input.projectAllowed ? [] : Object.keys(project)
  const projectMap = new Map(input.projectAllowed ? Object.entries(project) : [])

  const projectWins = input.onClash === 'project-wins'
  const shadowed: { name: string; winner: 'personal' | 'project' }[] = []
  const merged = new Map<string, McpServersMap[string]>(personalMap)
  for (const [name, cfg] of projectMap) {
    if (personalMap.has(name)) {
      shadowed.push({ name, winner: projectWins ? 'project' : 'personal' })
      if (projectWins) merged.set(name, cfg)
    } else {
      merged.set(name, cfg)
    }
  }
  const personal = [...personalMap.keys()].filter((n) => !(projectWins && projectMap.has(n)))
  return {
    servers: Object.fromEntries(merged),
    personal,
    projectWithheld,
    shadowed,
  }
}
