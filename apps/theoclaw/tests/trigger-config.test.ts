/**
 * B-397 FR-002 (AC-001): the triggers `THEOCLAW_TRIGGERS` names are read at start, and a bad one
 * refuses the start, naming the variable and never its value.
 */
import { createHmac } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { composeTheoClaw, startTheoClaw } from '../src/composition.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { eventSecrets, readEventSettings, readTriggerSettings } from '../src/triggers/trigger-settings.js'
import { capturingStream, fakeBuilders, noAgent, TELEGRAM_AND_LINE, WORKSPACE } from './composition-fixtures.js'
import { FakeAgent, assistant, finished } from './fakes.js'

const SECRET = 'a-secret-of-16ch'
const TELEGRAM = ['telegram'] as const

/** The refusal `readTriggerSettings` throws for `env`, which must be a `TheoClawConfigError`. */
function refusal(env: Record<string, string>, configured: readonly string[] = TELEGRAM): TheoClawConfigError {
  try {
    readTriggerSettings(env, configured as never)
  } catch (error) {
    expect(error).toBeInstanceOf(TheoClawConfigError)
    return error as TheoClawConfigError
  }
  throw new Error('readTriggerSettings accepted the environment')
}

const CI = { THEOCLAW_TRIGGERS: 'ci', THEOCLAW_TRIGGER_CI_SECRET: SECRET, THEOCLAW_TRIGGER_CI_REPLY_TO: 'telegram:42' }

describe('readTriggerSettings', () => {
  it('gives no triggers when THEOCLAW_TRIGGERS is unset', () => {
    expect(readTriggerSettings({}, TELEGRAM)).toEqual([])
  })

  it('gives no triggers when THEOCLAW_TRIGGERS is only whitespace (EC-6)', () => {
    expect(readTriggerSettings({ THEOCLAW_TRIGGERS: '  ' }, TELEGRAM)).toEqual([])
  })

  it('parses two triggers, with and without INSTRUCTIONS', () => {
    const settings = readTriggerSettings(
      {
        ...CI,
        THEOCLAW_TRIGGERS: 'ci, deploy-prod',
        THEOCLAW_TRIGGER_CI_INSTRUCTIONS: 'Summarise the build.',
        THEOCLAW_TRIGGER_DEPLOY_PROD_SECRET: `${SECRET}-2`,
        THEOCLAW_TRIGGER_DEPLOY_PROD_REPLY_TO: 'telegram:-100:7',
      },
      TELEGRAM,
    )
    expect(settings).toEqual([
      { name: 'ci', secret: SECRET, replyTo: { platform: 'telegram', channelId: '42' }, instructions: 'Summarise the build.' },
      { name: 'deploy-prod', secret: `${SECRET}-2`, replyTo: { platform: 'telegram', channelId: '-100:7' } },
    ])
  })

  it('refuses a trigger whose reply platform is not configured, naming the variable and the platform', () => {
    const error = refusal({ ...CI, THEOCLAW_TRIGGER_CI_REPLY_TO: 'slack:C1' })
    expect(error.variable).toBe('THEOCLAW_TRIGGER_CI_REPLY_TO')
    expect(error.message).toBe('THEOCLAW_TRIGGER_CI_REPLY_TO names slack, which is not configured')
    expect(error.message).not.toContain('C1')
  })

  it('refuses a missing SECRET, naming the variable', () => {
    const { THEOCLAW_TRIGGER_CI_SECRET: _unused, ...env } = CI
    expect(refusal(env).variable).toBe('THEOCLAW_TRIGGER_CI_SECRET')
  })

  it('refuses a missing REPLY_TO, naming the variable', () => {
    const { THEOCLAW_TRIGGER_CI_REPLY_TO: _unused, ...env } = CI
    expect(refusal(env).variable).toBe('THEOCLAW_TRIGGER_CI_REPLY_TO')
  })

  it('refuses a REPLY_TO with no channel id, never printing the value', () => {
    const error = refusal({ ...CI, THEOCLAW_TRIGGER_CI_REPLY_TO: 'telegram:' })
    expect(error.variable).toBe('THEOCLAW_TRIGGER_CI_REPLY_TO')
    expect(error.message).not.toContain('telegram:')
  })

  it('refuses a REPLY_TO with no platform separator', () => {
    expect(refusal({ ...CI, THEOCLAW_TRIGGER_CI_REPLY_TO: 'telegram' }).variable).toBe('THEOCLAW_TRIGGER_CI_REPLY_TO')
  })

  it('refuses a secret of 15 characters and accepts one of 16 (EC-2)', () => {
    const error = refusal({ ...CI, THEOCLAW_TRIGGER_CI_SECRET: 'x'.repeat(15) })
    expect(error.variable).toBe('THEOCLAW_TRIGGER_CI_SECRET')
    expect(error.message).not.toContain('x'.repeat(15))
    expect(readTriggerSettings({ ...CI, THEOCLAW_TRIGGER_CI_SECRET: 'x'.repeat(16) }, TELEGRAM)).toHaveLength(1)
  })

  it('refuses a name that does not match the pattern', () => {
    const error = refusal({ ...CI, THEOCLAW_TRIGGERS: 'CI' })
    expect(error.variable).toBe('THEOCLAW_TRIGGERS')
    expect(refusal({ ...CI, THEOCLAW_TRIGGERS: '1ci' }).variable).toBe('THEOCLAW_TRIGGERS')
    expect(refusal({ ...CI, THEOCLAW_TRIGGERS: `c${'i'.repeat(32)}` }).variable).toBe('THEOCLAW_TRIGGERS')
  })

  it('refuses a duplicate name', () => {
    const error = refusal({ ...CI, THEOCLAW_TRIGGERS: 'ci,ci' })
    expect(error.variable).toBe('THEOCLAW_TRIGGERS')
    expect(error.message).toContain('ci')
  })

  it('refuses `ci,` naming THEOCLAW_TRIGGERS and the empty entry position (EC-6)', () => {
    const error = refusal({ ...CI, THEOCLAW_TRIGGERS: 'ci,' })
    expect(error.variable).toBe('THEOCLAW_TRIGGERS')
    expect(error.message).toContain('2')
  })
})

describe('readEventSettings', () => {
  it('carries the triggers and the approved hook fingerprints', () => {
    const fingerprint = 'a'.repeat(64)
    const settings = readEventSettings({ ...CI, THEOCLAW_APPROVED_HOOKS: fingerprint }, TELEGRAM)
    expect(settings.triggers.map((trigger) => trigger.name)).toEqual(['ci'])
    expect(settings.approvedHooks).toEqual(new Set([fingerprint]))
  })

  it('refuses a bad approved list before any trigger is used', () => {
    expect(() => readEventSettings({ ...CI, THEOCLAW_APPROVED_HOOKS: 'nope' }, TELEGRAM)).toThrow('THEOCLAW_APPROVED_HOOKS')
  })
})

describe('eventSecrets', () => {
  it('lists every trigger secret and every approved fingerprint, for the output mask (NFR-003)', () => {
    const fingerprint = 'b'.repeat(64)
    const settings = readEventSettings({ ...CI, THEOCLAW_APPROVED_HOOKS: fingerprint }, TELEGRAM)
    expect([...eventSecrets(settings)].sort()).toEqual([SECRET, fingerprint].sort())
  })
})

/** FR-001: `/hooks/<name>` reaches its trigger's route in the composed app; anything else is refused. */
describe('the composed trigger routes', () => {
  const ENV = {
    ...TELEGRAM_AND_LINE,
    THEOCLAW_TRIGGERS: 'ci',
    THEOCLAW_TRIGGER_CI_SECRET: SECRET,
    THEOCLAW_TRIGGER_CI_REPLY_TO: 'telegram:42',
  }

  function signedPost(path: string, body = '{}'): Request {
    return new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}` },
      body,
    })
  }

  async function composed() {
    const { builders } = fakeBuilders()
    const app = composeTheoClaw({
      env: ENV,
      agentFactory: noAgent,
      triggerAgentFactory: async () => new FakeAgent({ frames: [assistant('done'), finished()] }),
      builders,
      write: () => undefined,
    })
    await app.loop.ready
    return app
  }

  it('answers 404 for a trigger name that is not configured', async () => {
    const { router, loop } = await composed()
    expect((await router(signedPost('/hooks/deploy'))).status).toBe(404)
    await loop.stopAll()
  })

  it('answers 405 for GET /hooks/ci', async () => {
    const { router, loop } = await composed()
    expect((await router(new Request('http://localhost/hooks/ci'))).status).toBe(405)
    await loop.stopAll()
  })

  it('answers 404 for POST /hooks/CI, and routes /hooks/ci/ like /hooks/ci (EC-7)', async () => {
    const { router, loop } = await composed()
    expect((await router(signedPost('/hooks/CI'))).status).toBe(404)
    expect((await router(signedPost('/hooks/ci/'))).status).toBe(202)
    await loop.stopAll()
  })

  it("routes a configured trigger's signed POST to its route (202)", async () => {
    const { router, loop } = await composed()
    expect((await router(signedPost('/hooks/ci'))).status).toBe(202)
    await loop.stopAll()
  })

  it('the start refuses a bad trigger before the listener is called', async () => {
    const listen = vi.fn()
    await expect(
      startTheoClaw({
        cwd: WORKSPACE,
        env: { ...ENV, THEOCLAW_TRIGGER_CI_REPLY_TO: 'slack:C1' },
        agentFactory: noAgent,
        builders: fakeBuilders().builders,
        signals: new EventEmitter(),
        exit: vi.fn(),
        listen,
        streams: [capturingStream()],
      }),
    ).rejects.toThrow('THEOCLAW_TRIGGER_CI_REPLY_TO names slack, which is not configured')
    expect(listen).not.toHaveBeenCalled()
  })
})

describe('the goal settings at start', () => {
  it('readEventSettings carries the goal budget', () => {
    expect(readEventSettings({ ...CI, THEOCLAW_GOAL_TOKEN_BUDGET: '700' }, TELEGRAM).goal.tokenBudget).toBe(700)
  })

  it('refuses a bad goal budget at start, naming the variable', () => {
    expect(() => readEventSettings({ ...CI, THEOCLAW_GOAL_TOKEN_BUDGET: '0' }, TELEGRAM)).toThrow('THEOCLAW_GOAL_TOKEN_BUDGET')
  })
})
