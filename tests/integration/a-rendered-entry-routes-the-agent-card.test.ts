import { describe, expect, it } from 'vitest'

import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'

/**
 * SI-020, raised by the surface-closure inventory judge.
 *
 * A previous fix widened the agents branch guard to admit `/.well-known/` and was covered by a test
 * that rendered the FRAGMENT in isolation. The fragment did contain the arm; every host gates the
 * fragment behind `/api/` before it is reached, so the arm was dead code on all three targets and
 * the agent card stayed exactly as unreachable as before. A fragment-level assertion is structurally
 * incapable of seeing the enclosing dispatch.
 *
 * So this asserts over the RENDERED HOST ENTRY, and asserts the ORDER: the card predicate must
 * appear before the guard that would otherwise send the path to static assets.
 */
describe('a rendered entry routes the agent card', () => {
  const AGENTS = [{ filePath: 'agents/chat.ts', agentPath: '/api/agents/chat', name: 'chat' }]
  const CARD = '/.well-known/chat/agent-card.json'

  const ENTRIES: readonly (readonly [string, string])[] = [
    [
      'cloudflare',
      renderCloudflareWorkerEntry({ ssrStreaming: false, agents: AGENTS, contextModule: 's.js' }),
    ],
    ['bun', renderBunEntry(3000)],
    ['deno-deploy', renderDenoEntry(3000)],
  ]

  it('test_the_card_path_is_not_swallowed_by_the_api_prefix_guard', () => {
    for (const [name, entry] of ENTRIES) {
      // The predicate the host must consult. Emitted from the agents fragment so there is one
      // definition of what an agent card path is, matching `agent-card-handler.ts`'s own regex.
      expect(entry, `${name}: the entry has no notion of an agent-card path`).toContain(
        '__theoIsAgentCardPath',
      )

      const lines = entry.split('\n')
      const apiGuard = lines.findIndex((l) => /startsWith\((['"])\/api\/\1\)/.test(l))
      expect(
        apiGuard,
        `${name}: no /api/ prefix guard found — this test is measuring nothing`,
      ).toBeGreaterThan(-1)

      // The guard that decides between the API surface and static assets must itself consult the
      // card predicate. Without this the branch below it is unreachable for the card path, which is
      // the exact defect: present in the source, dead in the emitted program.
      expect(
        lines[apiGuard],
        `${name}: the /api/ guard decides without consulting the card predicate, so the card path never reaches the agents branch`,
      ).toContain('__theoIsAgentCardPath')
    }
  })

  it('test_a_well_known_path_that_is_not_a_card_still_reaches_static_assets', () => {
    // The control. A blanket `/.well-known/` bypass would route `/.well-known/security.txt` away
    // from asset serving — trading an unreachable card for a broken well-known namespace.
    for (const [name, entry] of ENTRIES) {
      expect(entry, `${name}: the predicate is a prefix test, not the card shape`).toMatch(
        /\/\\?\.well-known\\?\/\[\^\/\]\+\\?\/agent-card\\?\.json/,
      )
    }
    expect(CARD).toMatch(/^\/\.well-known\/[^/]+\/agent-card\.json$/)
    expect('/.well-known/security.txt').not.toMatch(/^\/\.well-known\/[^/]+\/agent-card\.json$/)
  })
})
