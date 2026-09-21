import { describe, expect, it } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'

/**
 * SI-016. B-185 fixed a defect that was on all six Web deploy targets and the fix reaches three.
 * The CHANGELOG says so; nothing asserted it, so the limit lived in prose and the three uncovered
 * targets were indistinguishable from an oversight.
 *
 * Deferring the FIX is a decision with a reason — vercel threads a Node `nodeReq` through twelve
 * sites, netlify threads neither that nor a `Request`, aws-lambda builds one `Request`, and the
 * emitted branch is Web-Request-shaped and calls `createWebShim(request)`. Three request shapes
 * are three pieces of work, and widening B-185 to absorb them would widen an item already
 * executing (registered as B-235).
 *
 * Deferring the CHARACTERISATION is not a decision, it is a silence. This is the characterisation:
 * it fails the day a fourth target gains the fragment without the limit being re-declared, AND the
 * day one of the three that has it regresses. Both directions matter — a one-sided assertion here
 * would let the covered set shrink quietly, which is the defect B-185 itself was.
 */
const AGENTS = [{ filePath: 'agents/chat.js', agentPath: '/api/agents/chat', name: 'chat' }]

/** The call that makes the aux dispatcher reachable — the whole of what B-185 added. */
const AUX_DISPATCH = 'matchAgentAuxRoute'

const CARRIES = [
  ['cloudflare', () => renderCloudflareWorkerEntry({ ssrStreaming: false, agents: AGENTS })],
  ['bun', () => renderBunEntry(3000)],
  ['deno-deploy', () => renderDenoEntry(3000)],
] as const

const DOES_NOT = [
  ['vercel', () => renderVercelFunctionEntry()],
  ['netlify', () => renderNetlifyFunction()],
  ['aws-lambda', () => renderAwsLambdaEntry()],
] as const

describe('the agents fragment reaches three of six deploy targets', () => {
  for (const [name, render] of CARRIES) {
    it(`test_${name.replace(/-/g, '_')}_asks_the_aux_dispatcher`, () => {
      expect(render(), `${name} lost the aux dispatch B-185 added`).toContain(AUX_DISPATCH)
    })
  }

  for (const [name, render] of DOES_NOT) {
    it(`test_${name.replace(/-/g, '_')}_is_still_outside_the_fix`, () => {
      // Not an aspiration. If this fails, the fragment reached a fourth target and the limit
      // recorded in the CHANGELOG, in SI-016 and in B-235 is now wrong in a reader's favour —
      // which is the one direction nobody checks.
      expect(
        render(),
        `${name} now carries the fragment — update the declared limit rather than this assertion`,
      ).not.toContain(AUX_DISPATCH)
    })
  }

  it('test_the_split_is_three_and_three', () => {
    // The counts, so a copy-paste that duplicated a row cannot make the split read as 4/2.
    const carrying = CARRIES.filter(([, r]) => r().includes(AUX_DISPATCH)).length
    const not = DOES_NOT.filter(([, r]) => !r().includes(AUX_DISPATCH)).length

    expect({ carrying, not }).toEqual({ carrying: 3, not: 3 })
  })
})
