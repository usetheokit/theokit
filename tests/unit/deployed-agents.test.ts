/**
 * A deployed target serves an agent (usetheokit/theokit#367).
 *
 * ## The measurement that opened the issue
 *
 * `grep -rc "agent" packages/theo/src/adapters/*.ts` returned nothing across 14 files. The notion
 * did not exist in that layer: the generated entries route `/api/` exclusively through
 * `scanServerRoutes` + `executeRoute`, so `/api/agents/chat` matched no file route and fell into
 * `notFoundResponse()`.
 *
 * That is the gap that contradicts the framework's own stated reason to exist — "the agent is a
 * file, delivered by the same pipeline that serves the page". It was delivered by no pipeline at
 * all outside a machine running `theokit start`.
 */
import { describe, expect, it } from 'vitest'

import { deployedAgentsFragment } from '../../packages/theo/src/adapters/deployed-agents.js'

const AGENTS = [
  { filePath: 'agents/chat.ts', agentPath: '/api/agents/chat', name: 'chat' },
  { filePath: 'agents/triage.ts', agentPath: '/api/agents/triage', name: 'triage' },
]

describe('an app with no agents pays nothing', () => {
  it('test_no_agents_emits_no_imports_and_no_branch', () => {
    const fragment = deployedAgentsFragment({ kind: 'baked', agents: [] })

    // A target with no agents must emit exactly what it emitted before this existed.
    expect(fragment.imports).toEqual([])
    expect(fragment.declarations).toEqual([])
    expect(fragment.branch).toEqual([])
  })
})

describe('every scanned agent is baked into the entry', () => {
  const fragment = deployedAgentsFragment({ kind: 'baked', agents: AGENTS })

  it('test_each_agent_module_is_a_static_import', () => {
    // Static, on the build machine — a Worker has no filesystem to scan and no path to import(),
    // which is the same reason routes are baked (#369).
    const source = fragment.imports.join('\n')
    expect(source).toMatch(/import \* as \w+ from '\.\.\/\.\.\/agents\/chat\.ts'/)
    expect(source).toMatch(/import \* as \w+ from '\.\.\/\.\.\/agents\/triage\.ts'/)
  })

  it('test_the_table_is_keyed_by_agent_name_not_by_file_path', () => {
    // The URL carries the NAME, and the name is also what the access policy is judged under and
    // what the run's spans are labelled with (#406). A table keyed by path would make the lookup
    // depend on the server's directory layout.
    // Quote style is not the property — the KEY is. `JSON.stringify` is what emits the key, and
    // it is the right choice: a name with a quote in it would otherwise produce broken source.
    const decls = fragment.declarations.join('\n')
    expect(decls).toMatch(/['"]chat['"]\s*:/)
    expect(decls).toMatch(/['"]triage['"]\s*:/)
    expect(decls).not.toMatch(/agents\/chat\.ts['"]\s*:/)
  })

  it('test_the_branch_answers_the_agent_path_before_the_file_route_table', () => {
    const branch = fragment.branch.join('\n')
    // `/api/agents/<name>` must be claimed by the agent branch: it matches no file route, so
    // falling through to the route table is exactly how this produced a 404.
    expect(branch).toMatch(/\/api\/agents\//)
    expect(branch).toMatch(/mountAgent/)
  })

  it('test_an_unknown_agent_name_is_a_404_and_not_a_crash', () => {
    const branch = fragment.branch.join('\n')
    // A name nobody scanned must produce the same answer as any other unknown path. Reading
    // `undefined` off the table and handing it to `mountAgent` would surface as a 500.
    expect(branch).toMatch(/notFoundResponse\(\)/)
  })

  it('test_the_agent_name_is_passed_so_telemetry_and_policy_see_a_name', () => {
    // `agentName` is what the policy is judged under and what spans are labelled with. Omitting it
    // would make the deployed run label itself differently from the local one (#406).
    expect(fragment.branch.join('\n')).toMatch(/agentName/)
  })
})

describe('a target with a filesystem scans instead of baking', () => {
  const fragment = deployedAgentsFragment({
    kind: 'scan',
    projectRoot: 'cwd',
    loadModule: 'loadModule',
  })

  it('test_no_agent_module_is_imported_statically', () => {
    // Bun and Deno already scan their ROUTES at request time. Baking agents there would tie an
    // agent's existence to a rebuild on a target that can just look.
    expect(fragment.imports.join('\n')).not.toMatch(/import \* as/)
  })

  it('test_the_scan_is_cached_rather_than_repeated_per_request', () => {
    // The same shape the entry already gives routes. A readdir per request is a syscall per request
    // for an answer that changes only on deploy.
    expect(fragment.declarations.join('\n')).toMatch(/agentsCache/)
    expect(fragment.branch.join('\n')).toMatch(
      /if \(!agentsCache\) agentsCache = scanAgents\(cwd\)/,
    )
  })

  it('test_an_unknown_name_still_answers_404_without_loading_a_module', () => {
    const branch = fragment.branch.join('\n')
    // `find` returning undefined must short-circuit BEFORE the loader is asked for a path that
    // does not exist — otherwise a routing miss surfaces as a module-resolution crash.
    expect(branch).toMatch(/agentNode === undefined \? undefined :/)
    expect(branch).toMatch(/notFoundResponse\(\)/)
  })
})
