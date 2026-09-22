/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time scanner: walks `<projectRoot>/agents/` derived from cwd.
 * No HTTP input ever reaches these fs calls.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

import { walkSourceFiles } from '../_internal/scan-walker.js'

import { declaresAgentPolicy } from './detect-agent-policy.js'
import { MissingAgentPolicyError } from './errors.js'
import { createFileStampCache } from './file-stamp-cache.js'

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
  'workflows',
  'evals',
  'memory',
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
/**
 * Resolved paths already reported, so a per-request scan says it once — B-249, NFR-001.
 *
 * Keyed by the RESOLVED path rather than by the process: a test harness legitimately scans two
 * roots, and each distinct mistake deserves its own line. Same shape as `warnedAboutLegacySalt` in
 * `packages/http/src/action-encryption.ts`, and for the same reason: `scanAgents` runs per request
 * on a scanned deploy target, so an unbounded warning is a log flood on the exact path an anonymous
 * caller can drive.
 */
const reportedMissingDirs = new Set<string>()

export function scanAgents(projectRoot: string, configured?: string): AgentNode[] {
  const agentsDirName = configured ?? 'agents'
  // `agentsDirName` (config `agentsDir`, default "agents") — the dir holding `<name>.ts` agent
  // definitions, relative to the project root. May be nested (e.g. "core/agents"). (#95 follow-up)
  const agentsDir = join(projectRoot, agentsDirName)
  if (!existsSync(agentsDir) || !statSync(agentsDir).isDirectory()) {
    // B-249 — the same `[]` as before, and no longer the same silence.
    //
    // A configured value that resolves to nothing produced a result byte-identical to "this app
    // declares no agents", so a deployed `/api/agents/<name>` answered 404 with an empty log and an
    // operator had no reason to suspect configuration. The loudest way in is an ABSOLUTE path —
    // this parameter is a NAME joined onto the root, so `join()` silently yields
    // `<root><abs>` — but a typo, a missing nesting level and a directory a build did not copy all
    // land in exactly the same place, and one rule covers all four.
    //
    // Silent when NOTHING was configured: a project with no agents is the ordinary case, and a gate
    // that fires on ordinary work is a gate somebody disables. The parameter is OPTIONAL rather
    // than defaulted for exactly that reason — a default erases the difference between "nobody
    // configured this" and "somebody configured 'agents'", and only the first should stay quiet.
    //
    // The return value does not move (FR-003) and the contract stays relative (FR-004): reporting a
    // path that does not exist tells the operator what went wrong without widening a documented
    // public contract, which is a decision for a plan rather than a repair.
    if (configured !== undefined && !reportedMissingDirs.has(agentsDir)) {
      reportedMissingDirs.add(agentsDir)
      console.warn(
        `[theokit] agentsDir ${JSON.stringify(agentsDirName)} resolves to ${JSON.stringify(agentsDir)}, ` +
          `which is not a directory, so NO agents were found and every /api/agents/* route will 404. ` +
          `The value is a path relative to the project root ${JSON.stringify(projectRoot)} — an ` +
          `absolute path is joined onto it and cannot resolve.`,
      )
    }
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
    const agentPath = `/api/agents/${rel}`
    assertAgentDeclaresPolicy(absPath, agentPath)
    results.push({
      filePath: absPath,
      agentPath,
      name: rel,
    })
  })
  return results
}

/**
 * Cache of the policy-declaration answer, keyed by path + mtime + size.
 *
 * `theokit dev` re-scans the agents directory on EVERY request, so parsing each agent file with the
 * TypeScript AST per request would turn a build-time check into per-request latency. Keying on the
 * file's own mtime and size means an edit invalidates the entry without anyone remembering to, and
 * a `theokit build` (one process, one scan) never notices the cache exists.
 */
const policyDeclarationCache = createFileStampCache<boolean>()

/** Test seam — the module-level cache would otherwise outlive a fixture directory. */
export function _resetAgentPolicyCacheForTests(): void {
  policyDeclarationCache.clear()
}

/**
 * Refuse an agent file that declares no access policy (usetheokit/theokit#365).
 *
 * The refusal lives in the scanner, next to the reserved-name and empty-name refusals, because this
 * is the one place every entry point passes through: `theokit build`, `theokit start`, `theokit dev`
 * and the manifest generator all reach agents by calling `scanAgents`.
 *
 * The blast radius stops at the file system, exactly as it does for routes. A module handed to
 * `mountAgent` in memory — a test, an embedder, an `@Expose`d controller method — never passed a
 * scanner, and `admitAgentRequest` still treats an undeclared policy as "not declared" rather than
 * as denial. Absence is refused where an application DECLARES its agents, not where a caller passes
 * one.
 */
function assertAgentDeclaresPolicy(filePath: string, agentPath: string): void {
  // The stamping and the `has`-vs-truthy subtlety moved into `createFileStampCache` (#417), where
  // the route scanner shares them rather than growing a second copy keyed "the same way".
  const declared = policyDeclarationCache.get(filePath, () =>
    declaresAgentPolicy(filePath, readFileSync(filePath, 'utf8')),
  )
  if (!declared) throw new MissingAgentPolicyError({ file: filePath, agentPath })
}
