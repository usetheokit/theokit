/**
 * The shared `proof-imports-only-published-entry-points` rule is the rule each app defines today,
 * so switching an app onto the shared module changes nothing (TOOL-04).
 */
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO = resolve(import.meta.dirname, '../..')
const RULE = 'proof-imports-only-published-entry-points'
const require = createRequire(import.meta.url)

interface ForbiddenRule {
  name: string
}

const shared = (
  require(join(REPO, 'tooling/depcruise/proof-boundary.cjs')) as {
    proofImportsOnlyPublishedEntryPoints: ForbiddenRule
  }
).proofImportsOnlyPublishedEntryPoints

describe('the shared proof boundary rule', () => {
  it.each(['theocode', 'theoclaw'])("equals each app's rule (%s)", (app) => {
    const config = require(join(REPO, 'apps', app, '.dependency-cruiser.cjs')) as {
      forbidden: ForbiddenRule[]
    }
    const rule = config.forbidden.find((r) => r.name === RULE)
    expect(rule).toBeDefined()
    expect(shared).toEqual(rule)
  })
})
