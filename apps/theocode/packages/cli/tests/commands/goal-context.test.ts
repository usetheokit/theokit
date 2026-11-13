import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { routeToCredential } from '@theocode/agent/auth'
import { trustStorePath } from '@theocode/agent/config'

import { resolveGoalContext } from '../../src/commands/goal.js'
import { composeRun } from '../../src/run-composition.js'

const oauth = { kind: 'oauth', provider: 'openai' } as const
let dir: string
let home: string
let store: string
const env = { OPENROUTER_API_KEY: 'sk-or-test' }

function goalArgs(model?: string) {
  return { goal: 'g', overrides: [], ...(model === undefined ? {} : { model }) } as never
}

const savedHome = process.env.THEOKIT_HOME

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'goal-ctx-'))
  home = join(dir, 'home')
  mkdirSync(home)
  mkdirSync(join(home, '.theocode'))
  writeFileSync(
    join(home, '.theocode', 'auth.json'),
    JSON.stringify({ provider: 'openai', api_key: 'sk-test' }),
    { mode: 0o600 },
  )
  store = join(dir, 'trusted-dirs.json')
  writeFileSync(store, JSON.stringify({ trusted: [] }), { mode: 0o600 })
})

afterEach(() => {
  if (savedHome === undefined) delete process.env.THEOKIT_HOME
  else process.env.THEOKIT_HOME = savedHome
  rmSync(dir, { recursive: true, force: true })
})

describe('#1896 — goal routes the model like run', () => {
  it('routes an explicit -m through a ChatGPT OAuth credential, as run does', async () => {
    const seams = { cwd: dir, store, userDir: home, env, probe: oauth }
    const goal = await resolveGoalContext(goalArgs('openai/gpt-5'), seams)
    const run = await composeRun(
      {
        overrides: [],
        model: 'openai/gpt-5',
        routeModel: (id) => routeToCredential(oauth, id),
      },
      { cwd: dir, store, userDir: home, env },
    )
    expect(goal.routedModel).toBe('openai-chatgpt/gpt-5')
    expect(goal.routedModel).toBe(run.model)
  })

  it('still routes cfg.model when -m is absent', async () => {
    const seams = { cwd: dir, store, userDir: home, env, probe: oauth }
    const goal = await resolveGoalContext(goalArgs(), seams)
    const bare = goal.cfg.model.slice(goal.cfg.model.lastIndexOf('/') + 1)
    expect(goal.routedModel).toBe(`openai-chatgpt/${bare}`)
  })

  it('reads the trust store from the given env, not process.env', async () => {
    const other = join(dir, 'ambient')
    mkdirSync(other)
    writeFileSync(join(other, 'trusted-dirs.json'), JSON.stringify({ trusted: [] }), {
      mode: 0o600,
    })
    process.env.THEOKIT_HOME = other
    mkdirSync(join(dir, '.theocode'), { recursive: true })
    writeFileSync(
      join(dir, '.theocode', 'settings.json'),
      JSON.stringify({ reasoning_effort: 'high' }),
    )
    // The injected env points at `home`, whose store trusts `dir`; the ambient one trusts nothing.
    writeFileSync(join(home, 'trusted-dirs.json'), JSON.stringify({ trusted: [dir] }), {
      mode: 0o600,
    })
    const injected = { ...env, THEOKIT_HOME: home }
    const result = await resolveGoalContext(goalArgs(), { cwd: dir, userDir: home, env: injected })
    expect(trustStorePath(injected)).not.toBe(trustStorePath(process.env))
    expect(result.cfg.reasoning_effort).toBe('high')
  })
})
