/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time scanner: walks `<projectRoot>/agents/` derived from cwd.
 * No HTTP input ever reaches these fs calls.
 */
import { existsSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

import { walkSourceFiles } from '../_internal/scan-walker.js'

const AGENT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
// Convention § 5: a co-located test file is not an agent.
const TEST_FILE = /\.(test|spec)$/

/**
 * Folder-semantic discovery (Eve-style "file = identity"): an agent may be a self-contained folder that
 * co-locates its composition — `agents/<name>/{index.ts, tools/, skills/, prompts/, lib/}`. Files INSIDE
 * these conventional sub-folders are that concern (a tool, a skill, a prompt, a helper), NOT a routed
 * agent, so the scanner skips any file whose path passes through one of them. Only `<name>.ts` or
 * `<name>/index.ts` is served at `/api/agents/<name>`. A flat file literally named `tools.ts` is still a
 * valid agent (the reserved names only apply to intermediate DIRECTORIES, never the agent file itself).
 */
const AGENT_SUBFOLDERS = new Set([
  'tools',
  'skills',
  'prompts',
  'lib',
  'hooks',
  'channels',
  'connections',
  'subagents',
  'schedules',
  'sandbox',
])

/**
 * A discovered agent file. `name` is the client-facing key; `agentPath` is the mounted
 * SSE route (M0/M1 `UIMessageStream`).
 */
export interface AgentNode {
  filePath: string
  agentPath: string
  name: string
}

/**
 * M2 — scan the TOP-LEVEL `agents/` convention (sibling of `server/`, per the LOCKED naming
 * decision). Mirrors `scanWebSocketRoutes`: one file → one endpoint, `index` stripped.
 */
export function scanAgents(projectRoot: string, agentsDirName = 'agents'): AgentNode[] {
  // `agentsDirName` (config `agentsDir`, default "agents") — the dir holding `<name>.ts` agent
  // definitions, relative to the project root. May be nested (e.g. "core/agents"). (#95 follow-up)
  const agentsDir = join(projectRoot, agentsDirName)
  if (!existsSync(agentsDir) || !statSync(agentsDir).isDirectory()) {
    return []
  }

  const results: AgentNode[] = []
  walkSourceFiles(agentsDir, { extensions: AGENT_EXTENSIONS }, (absPath) => {
    let rel = relative(agentsDir, absPath)
    rel = rel.replace(/\\/g, '/')
    rel = rel.slice(0, -extname(rel).length)
    if (TEST_FILE.test(rel)) return
    // Eve-style: a file living under a composition sub-folder (tools/, skills/, prompts/, …) is that
    // concern, not a routed agent. Check the intermediate DIRECTORIES only — the agent file itself may
    // be named anything.
    const dirs = rel.split('/').slice(0, -1)
    if (dirs.some((segment) => AGENT_SUBFOLDERS.has(segment))) return
    // Unlike routes/ws, an agent needs an explicit name — a bare `agents/index.ts`
    // (name `''` → `/api/agents/`) is nonsensical for a typed `useAgent(name)` binding.
    // `agents/foo/index.ts` still collapses to `foo` (a named nested agent).
    if (rel.endsWith('/index')) rel = rel.slice(0, -6)
    if (rel === 'index' || rel === '') return
    results.push({
      filePath: absPath,
      agentPath: `/api/agents/${rel}`,
      name: rel,
    })
  })
  return results
}
