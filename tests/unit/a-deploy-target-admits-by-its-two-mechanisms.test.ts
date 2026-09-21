import { describe, expect, it } from 'vitest'

import { deployedAgentsFragment } from '../../packages/theo/src/adapters/deployed-agents.js'

/**
 * SI-012 and SI-017, both raised by the surface-closure inventory judge against a set of ten items
 * that said "a deployed target" where ADR 0014 decides TWO mechanisms, and that claimed routing
 * where the change altered admission.
 */
describe('a deploy target admits by its two mechanisms', () => {
  const AGENTS = [{ name: 'a', filePath: 'a.ts', agentPath: '/api/agents/a' }]
  const emit = (source: Parameters<typeof deployedAgentsFragment>[0]): string => {
    const f = deployedAgentsFragment(source, {})
    return [...f.imports, ...f.declarations, ...f.branch].join('\n')
  }

  it('test_each_host_kind_resolves_identity_by_the_means_its_platform_allows', () => {
    // SI-017. One Worker case can satisfy every item phrased as "a deployed target" while the
    // filesystem path — the one ADR 0014 records a reviewer would have dropped entirely — goes
    // unclaimed. These assert the two mechanisms apart, so neither can stand in for the other.
    const baked = emit({ kind: 'baked', agents: AGENTS, contextModule: 'server/context.js' })
    expect(baked, 'a host with no filesystem must take the factory from a baked module').toContain(
      'createSubjectResolverFromFactory',
    )
    expect(baked, 'a baked host has no serverDir to locate anything on').not.toContain(
      'createAgentSubjectResolver',
    )

    const scanned = emit({
      kind: 'scan',
      projectRoot: 'cwd',
      loadModule: 'loadModule',
      serverDir: 'serverDir',
    })
    expect(scanned, 'a host WITH a filesystem locates its own context module').toContain(
      'createAgentSubjectResolver',
    )
    expect(scanned, 'and must not import a module the build never baked for it').not.toContain(
      'createSubjectResolverFromFactory',
    )
  })

  it('test_the_run_route_judges_its_policy_against_the_same_caller_the_aux_routes_see', () => {
    // SI-012. `agent-access.ts:145` returns early for an absent or `public` policy without reading
    // the subject, so for those two nothing changes. For any OTHER declared policy the subject went
    // from `null` — which refused an owner exactly like a stranger — to the real caller.
    //
    // That is the intended fix and it is a change in who is admitted, on a route no item claimed:
    // SI-008 asserts only that the branch still REACHES mountAgent, which is routing.
    const emitted = emit({ kind: 'baked', agents: AGENTS, contextModule: 'server/context.js' })

    const lines = emitted.split('\n')
    const open = lines.findIndex((l) => l.includes('mountAgent('))
    expect(open, 'the branch no longer calls mountAgent at all').toBeGreaterThan(-1)
    const close = lines.findIndex((l, i) => i > open && l.trim() === '})')
    const mountOptions = lines.slice(open, close).join('\n')

    expect(
      mountOptions,
      'the run route is left judging its policy against an anonymous caller',
    ).toContain('resolveSubject')
  })
})
