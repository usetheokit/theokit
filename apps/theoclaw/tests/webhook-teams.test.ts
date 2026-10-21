import { describe, expect, it } from 'vitest'

import type { TeamsActivityVerifyResult } from '@theokit/gateway-teams'

import { createTeamsRoute, statusForRefusal } from '../src/webhooks/teams.js'
import type { TeamsVerifier } from '../src/webhooks/teams.js'
import { FakeAdapter } from './fakes.js'

const MESSAGE_ACTIVITY = {
  type: 'message',
  id: 'activity-1',
  text: 'hello theo',
  from: { id: 'user-1', name: 'User' },
  conversation: { id: 'conversation-1', conversationType: 'personal' },
  serviceUrl: 'https://smba.trafficmanager.net/teams/',
}

const accept = (activity: Record<string, unknown>): TeamsVerifier => async () => ({
  ok: true,
  activity,
  token: { appId: 'app-id', serviceUrl: 'https://smba.trafficmanager.net/teams/' },
})

const refuse = (reason: Extract<TeamsActivityVerifyResult, { ok: false }>['reason']): TeamsVerifier => async () => ({
  ok: false,
  reason,
  message: `refused: ${reason}`,
})

function post(): Request {
  return new Request('http://localhost/webhooks/teams', { method: 'POST', body: JSON.stringify(MESSAGE_ACTIVITY) })
}

function subscribedTeams(): { adapter: FakeAdapter; delivered: string[] } {
  const adapter = new FakeAdapter('teams')
  const delivered: string[] = []
  adapter.onInbound(async (event) => {
    delivered.push(event.text)
  })
  return { adapter, delivered }
}

const ELEVEN_REASONS = [
  'missing_authorization',
  'malformed_body',
  'body_already_read',
  'validator_unavailable',
  'invalid_token',
  'key_set_unavailable',
  'audience_mismatch',
  'serviceurl_mismatch',
  'channel_mismatch',
  'tenant_mismatch',
  'tenant_unverified',
] as const

describe('createTeamsRoute', () => {
  it('never delivers an activity the package verification rejected', async () => {
    const { adapter, delivered } = subscribedTeams()

    const response = await createTeamsRoute({ verify: refuse('invalid_token'), adapter, write: () => undefined })(post())

    expect(response.status).toBe(401)
    expect(delivered).toHaveLength(0)
  })

  it('answers 503 when deliver returns no_handler', async () => {
    const adapter = new FakeAdapter('teams')

    const response = await createTeamsRoute({ verify: accept(MESSAGE_ACTIVITY), adapter, write: () => undefined })(post())

    expect(response.status).toBe(503)
  })

  it('delivers an accepted message activity', async () => {
    const { adapter, delivered } = subscribedTeams()

    const response = await createTeamsRoute({ verify: accept(MESSAGE_ACTIVITY), adapter, write: () => undefined })(post())

    expect(response.status).toBe(200)
    expect(delivered).toEqual(['hello theo'])
  })

  it('maps each refusal reason to its status', async () => {
    const expected: Record<(typeof ELEVEN_REASONS)[number], number> = {
      missing_authorization: 401,
      malformed_body: 400,
      body_already_read: 500,
      validator_unavailable: 503,
      invalid_token: 401,
      key_set_unavailable: 503,
      audience_mismatch: 401,
      serviceurl_mismatch: 401,
      channel_mismatch: 401,
      tenant_mismatch: 401,
      tenant_unverified: 401,
    }
    for (const reason of ELEVEN_REASONS) {
      const { adapter, delivered } = subscribedTeams()
      const lines: string[] = []
      const response = await createTeamsRoute({ verify: refuse(reason), adapter, write: (line) => lines.push(line) })(post())
      expect([reason, response.status]).toEqual([reason, expected[reason]])
      expect(statusForRefusal(reason)).toBe(expected[reason])
      expect(delivered).toHaveLength(0)
      expect(lines).toHaveLength([400, 401].includes(expected[reason]) ? 0 : 1)
    }
  })

  it('acknowledges a non message activity without delivering', async () => {
    const { adapter, delivered } = subscribedTeams()

    const response = await createTeamsRoute({
      verify: accept({ type: 'conversationUpdate' }),
      adapter,
      write: () => undefined,
    })(post())

    expect(response.status).toBe(200)
    expect(delivered).toHaveLength(0)
  })

  it('a throwing verifier is a refusal', async () => {
    const { adapter, delivered } = subscribedTeams()
    const lines: string[] = []

    const response = await createTeamsRoute({
      verify: async () => {
        throw new Error('jwks fetch exploded')
      },
      adapter,
      write: (line) => lines.push(line),
    })(post())

    expect(response.status).toBe(401)
    expect(delivered).toHaveLength(0)
    expect(lines).toHaveLength(1)
  })
})
