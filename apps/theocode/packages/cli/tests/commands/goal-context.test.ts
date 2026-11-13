/**
 * #1896 — `goal -m` skipped the credential routing `run -m` applies, and read posture, store and
 * config from the ambient `process.env`. Both now go through `resolveRunContext`.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@theocode/agent/auth', async (orig) => {
  const real = await orig<typeof import('@theocode/agent/auth')>()
  return {
    ...real,
    resolveCredential: () => ({ kind: 'oauth', provider: 'openai', apiKey: 'tok' }),
    resolveCredentialForModel: async () => ({ kind: 'oauth', provider: 'openai', apiKey: 'tok' }),
  }
})

import { resolveGoalContext } from '../../src/commands/goal.js'
import { resolveRunContext } from '../../src/run-composition.js'

let dir: string
let env: Record<string, string | undefined>

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'goal-ctx-')))
  env = { THEOKIT_HOME: join(dir, 'state') }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('resolveGoalContext', () => {
  it('test_goal_dash_m_routes_through_the_chatgpt_credential_like_run', async () => {
    const seams = { cwd: dir, env, userDir: dir }
    const goal = await resolveGoalContext({ goal: 'g', overrides: [], model: 'openai/gpt-5' } as never, seams)
    const run = resolveRunContext(
      { overrides: [], model: 'openai/gpt-5', routeModel: (id) => `openai-chatgpt/${id.split('/').pop()}` },
      seams,
    )
    expect(goal.routedModel).toBe('openai-chatgpt/gpt-5')
    expect(goal.routedModel).toBe(run.model)
  })

  it('test_goal_without_dash_m_still_routes_the_configured_model', async () => {
    const goal = await resolveGoalContext({ goal: 'g', overrides: [] } as never, {
      cwd: dir,
      env,
      userDir: dir,
    })
    expect(goal.routedModel.startsWith('openai-chatgpt/')).toBe(true)
    expect(goal.routedModel).toBe(
      `openai-chatgpt/${goal.cfg.model.slice(goal.cfg.model.lastIndexOf('/') + 1)}`,
    )
  })

  it('test_goal_reads_the_trust_store_from_the_env_it_is_given', async () => {
    mkdirSync(join(dir, 'state'), { recursive: true })
    writeFileSync(join(dir, 'state', 'trusted-dirs.json'), JSON.stringify({ trusted: [dir] }), {
      mode: 0o600,
    })
    const other = mkdtempSync(join(tmpdir(), 'goal-ctx-other-'))
    const prev = process.env.THEOKIT_HOME
    process.env.THEOKIT_HOME = other
    try {
      const fromEnv = await resolveGoalContext({ goal: 'g', overrides: [] } as never, {
        cwd: dir,
        env,
        userDir: dir,
      })
      const empty = await resolveGoalContext({ goal: 'g', overrides: [] } as never, {
        cwd: dir,
        env: { THEOKIT_HOME: other },
        userDir: dir,
      })
      expect(fromEnv.posture).not.toEqual(empty.posture)
    } finally {
      if (prev === undefined) delete process.env.THEOKIT_HOME
      else process.env.THEOKIT_HOME = prev
      rmSync(other, { recursive: true, force: true })
    }
  })
})
