import { describe, expect, it } from 'vitest'

import { deployedAgentsFragment } from '../../packages/theo/src/adapters/deployed-agents.js'

/**
 * SI-015, raised by the surface-closure inventory judge.
 *
 * `matchGetAuxRoute` serves `GET /.well-known/<name>/agent-card.json` (M15), and the dispatcher's
 * own header states dev and prod must serve its six families identically. The emitted branch guard
 * admitted one prefix, so the card could never reach the matcher on any deploy target — five
 * families reachable, the sixth excluded by the guard rather than by a decision.
 */
describe('a deploy target serves the agent card', () => {
  const AGENTS = [{ name: 'a', filePath: 'a.ts', agentPath: '/api/agents/a' }]
  const emit = (): string => {
    const f = deployedAgentsFragment(
      { kind: 'baked', agents: AGENTS, contextModule: 'server/context.js' },
      {},
    )
    return [...f.imports, ...f.declarations, ...f.branch].join('\n')
  }

  it('test_the_branch_guard_admits_the_well_known_card_path', () => {
    expect(emit(), 'the card path can never reach the aux dispatcher').toContain('/.well-known/')
  })

  it('test_a_well_known_path_the_matcher_declines_does_not_reach_the_run_handler', () => {
    // The half that makes widening the guard safe. `agentName` is derived by slicing the
    // `/api/agents/` prefix; a `.well-known` url that the matcher declines would slice a prefix it
    // does not have and hand the garbage to `mountAgent` — a 500 for what is a routing miss, which
    // is strictly worse than the 404 it replaced.
    const emitted = emit()
    const branch = emitted.slice(emitted.indexOf('/.well-known/'))
    const beforeMount = branch.slice(0, branch.indexOf('mountAgent('))
    expect(
      beforeMount,
      'nothing stops a declined .well-known url from slicing a prefix it does not have',
    ).toMatch(/startsWith\(['"]\/api\/agents\/['"]\)/)
  })
})
