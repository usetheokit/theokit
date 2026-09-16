/**
 * B-033's split, reintroduced one hop lower.
 *
 * `run-composition.ts` resolves the posture and the configuration from ONE environment, and its
 * comment records why: the two used to disagree inside a single run. `resolveEffectiveConfig` then
 * called `resolveTrustPosture(cwd, opts.store)` with two arguments and let `env` default to the
 * ambient one — so a caller injecting an environment got its configuration from the injection and
 * its trust decision from the process.
 *
 * That was already wrong; `settings.json` makes it expensive. The project layer is gated on trust,
 * so a posture resolved from the wrong environment decides whether a whole configuration file is
 * read at all.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveEffectiveConfig } from '../../src/config/effective-config.js'

let project: string
let store: string

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'theocode-eff-env-'))
  store = join(project, 'trusted-dirs.json')
  writeFileSync(store, JSON.stringify({ trusted: [] }), { mode: 0o600 })
  mkdirSync(join(project, '.theokit'), { recursive: true })
  writeFileSync(
    join(project, '.theokit', 'settings.json'),
    JSON.stringify({ model: 'openai/from-project' }),
  )
})
afterEach(() => {
  rmSync(project, { recursive: true, force: true })
})

describe('the posture comes from the environment the caller injected', () => {
  it('test_an_injected_grant_is_honoured', () => {
    const cfg = resolveEffectiveConfig({
      cwd: project,
      projectDir: project,
      store,
      env: { THEOCODE_TRUST_ALL_DIRS: '1' },
    })

    expect(
      cfg.model,
      'the injected environment granted trust and the project config was still withheld',
    ).toBe('openai/from-project')
  })

  it('test_an_injected_environment_without_the_grant_still_withholds', () => {
    // Anti-vacuity floor: without this arm, a loader that ignored trust entirely would pass above.
    const cfg = resolveEffectiveConfig({ cwd: project, projectDir: project, store, env: {} })

    expect(cfg.model).not.toBe('openai/from-project')
  })
})
