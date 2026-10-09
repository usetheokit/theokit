import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveLiveModel as resolveInTheoCode } from '../../apps/theocode/packages/agent/tests/live/live-model.js'
import { DEFAULT_LIVE_MODEL as PREFLIGHT_DEFAULT } from '../../scripts/live-model-preflight.mjs'
import { DEFAULT_LIVE_MODEL, resolveLiveModel } from '../../scripts/live-model.mjs'

/**
 * The live-model job sets one `LIVE_MODEL` for the preflight and both live steps (B-415, CX-3).
 * One variable is one model only if every reader resolves it the same way: the preflight trimmed
 * it and fell back to the default, while the live files sent `process.env.LIVE_MODEL ?? default`
 * verbatim, so a whitespace-only value reached the provider as a model id (review F-dom-1, plan
 * panel round 3). Every reader now goes through `resolveLiveModel`.
 */
const ROOT = resolve(__dirname, '../..')
const AGENTS_LIVE = join(ROOT, 'packages/agents/tests/live')
const THEOCODE_PACKAGES = join(ROOT, 'apps/theocode/packages')
const THEOCODE_A2A_TEST = join(
  THEOCODE_PACKAGES,
  'agent/tests/live/an-a2a-call-reaches-a-real-model.test.ts',
)

function liveTests(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => /\.test\.(ts|tsx|mjs)$/.test(name))
        .map((name) => join(dir, name))
    : []
}

const CASES: [Record<string, string | undefined>, string][] = [
  [{}, DEFAULT_LIVE_MODEL],
  [{ LIVE_MODEL: '' }, DEFAULT_LIVE_MODEL],
  [{ LIVE_MODEL: '   ' }, DEFAULT_LIVE_MODEL],
  [{ LIVE_MODEL: '\t\n ' }, DEFAULT_LIVE_MODEL],
  [{ LIVE_MODEL: 'anthropic/claude-x' }, 'anthropic/claude-x'],
  [{ LIVE_MODEL: '  anthropic/claude-x \n' }, 'anthropic/claude-x'],
]

describe('resolveLiveModel', () => {
  it.each(CASES)('resolves %j to %j', (env, model) => {
    expect(resolveLiveModel(env)).toBe(model)
  })

  it('is the default the preflight exports', () => {
    expect(PREFLIGHT_DEFAULT).toBe(DEFAULT_LIVE_MODEL)
  })

  // TheoCode reaches theokit only through published entry points, so it restates the resolver
  // (D9, D11). Restated is only safe while it agrees, case for case.
  it.each(CASES)('agrees with TheoCode on %j', (env, model) => {
    expect(resolveInTheoCode(env)).toBe(model)
  })
})

describe('the live files', () => {
  const agentsFiles = liveTests(AGENTS_LIVE)
  // Every live test of every TheoCode package, so a live file added later is checked without
  // anyone remembering to list it here (plan panel round 4).
  const theocodeFiles = readdirSync(THEOCODE_PACKAGES).flatMap((pkg) =>
    liveTests(join(THEOCODE_PACKAGES, pkg, 'tests/live')),
  )

  it.each([...agentsFiles, ...theocodeFiles])('%s never reads LIVE_MODEL itself', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(/process\.env(\.LIVE_MODEL|\[['"`]LIVE_MODEL)/)
  })

  it.each([...agentsFiles, THEOCODE_A2A_TEST])(
    '%s resolves its model through resolveLiveModel',
    (file) => {
      expect(readFileSync(file, 'utf8')).toMatch(/const MODEL = resolveLiveModel\(process\.env\)/)
    },
  )

  it('covers the three agents live files and the TheoCode A2A test', () => {
    expect(agentsFiles).toHaveLength(3)
    expect(theocodeFiles).toContain(THEOCODE_A2A_TEST)
  })
})
