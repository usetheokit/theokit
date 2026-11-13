/**
 * The shared rule in `tooling/depcruise/proof-boundary.cjs` is the rule each app defines today, so
 * the later switch in each app to the shared module is a no-op.
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

describe('the shared proof boundary rule', () => {
  it.each(['theocode', 'theoclaw'])("equals each app's rule: %s", (app) => {
    const config = require(join(REPO, 'apps', app, '.dependency-cruiser.cjs')) as {
      forbidden: ForbiddenRule[]
    }
    const shared = (
      require(join(REPO, 'tooling/depcruise/proof-boundary.cjs')) as {
        proofImportsOnlyPublishedEntryPoints: ForbiddenRule
      }
    ).proofImportsOnlyPublishedEntryPoints
    expect(config.forbidden.find((r) => r.name === RULE)).toEqual(shared)
  })
})
