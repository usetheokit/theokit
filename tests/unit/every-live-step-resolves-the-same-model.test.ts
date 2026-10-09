import { readFileSync, readdirSync } from 'node:fs'
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
const THEOCODE_LIVE_TEST = join(
  ROOT,
  'apps/theocode/packages/agent/tests/live/an-a2a-call-reaches-a-real-model.test.ts',
)

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
  const agentsFiles = readdirSync(AGENTS_LIVE)
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => join(AGENTS_LIVE, name))

  it.each([...agentsFiles, THEOCODE_LIVE_TEST])(
    '%s resolves its model through resolveLiveModel and never reads LIVE_MODEL itself',
    (file) => {
      const source = readFileSync(file, 'utf8')
      expect(source).toMatch(/const MODEL = resolveLiveModel\(process\.env\)/)
      expect(source).not.toMatch(/process\.env\.LIVE_MODEL/)
    },
  )

  it('covers the three agents live files', () => {
    expect(agentsFiles).toHaveLength(3)
  })
})
