/**
 * CLI-09 (#1896) — `goal` must resolve its model, posture, store and config the way `run` does:
 * `-m` is picked first and THEN routed for the credential, and everything reads one `env`.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('@theocode/agent/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@theocode/agent/auth')>()),
  resolveCredentialForModel: async () => ({ apiKey: 'k', kind: 'oauth', provider: 'openai' }),
}))

import { routeToCredential } from '@theocode/agent/auth'

import { resolveGoalContext } from '../../src/commands/goal.js'
import { resolveCompositionContext, routeRequestedModel } from '../../src/run-composition.js'

const root = mkdtempSync(join(tmpdir(), 'goal-context-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const seams = (env: Record<string, string | undefined> = {}) => ({
  cwd: root,
  home: root,
  userDir: root,
  env: { THEOCODE_HOME: root, ...env },
  store: undefined,
})
const goalArgs = (model?: string) =>
  ({ goal: 'g', overrides: [], ...(model ? { model } : {}) }) as never

describe('resolveGoalContext', () => {
  it('routes -m through the ChatGPT credential exactly as run does', async () => {
    const ctx = await resolveGoalContext(goalArgs('openai/gpt-5'), seams())
    const cfg = resolveCompositionContext([] as never, seams()).cfg
    const runModel = routeRequestedModel('openai/gpt-5', cfg, (id) =>
      routeToCredential({ kind: 'oauth', provider: 'openai' }, id),
    )
    expect(ctx.routedModel).toBe(runModel)
    expect(ctx.routedModel).toBe('openai-chatgpt/gpt-5')
  })

  it('still routes cfg.model when there is no -m', async () => {
    const ctx = await resolveGoalContext(goalArgs(), seams())
    const nu = ctx.cfg.model.slice(ctx.cfg.model.lastIndexOf('/') + 1)
    expect(ctx.routedModel).toBe(`openai-chatgpt/${nu}`)
  })

  it('reads trust from the env it is given, not process.env', async () => {
    const before = process.env.THEOCODE_TRUST_ALL_DIRS
    delete process.env.THEOCODE_TRUST_ALL_DIRS
    try {
      const trusted = await resolveGoalContext(goalArgs(), seams({ THEOCODE_TRUST_ALL_DIRS: '1' }))
      const untrusted = await resolveGoalContext(goalArgs(), seams())
      expect(trusted.posture).not.toEqual(untrusted.posture)
      expect(trusted.env.THEOCODE_HOME).toBe(root)
    } finally {
      if (before !== undefined) process.env.THEOCODE_TRUST_ALL_DIRS = before
    }
  })
})
