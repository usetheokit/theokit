import { describe, expect, it } from 'vitest'

import { descriptorFor, resolvePlatforms } from '../src/channels/platforms.js'
import { offlineAdapter } from './composition-fixtures.js'
import { gatewayRouter } from './webhook-fixtures.js'

/*
 * The Teams webhook as the gateway's webhook handler serves it. Which token a Bot Framework
 * activity must carry, and the status of each refusal reason, are `@theokit/gateway-teams`' own
 * (its descriptor builds the verifier from the client id alone); what is checked here is that
 * TheoClaw serves it: nothing unverified is delivered, and the handler's statuses hold.
 * Moved to that package, which owns the verifier: "delivers an accepted message activity", "delivers a
 * mention-only message activity", "acknowledges a non message activity", "maps each refusal reason to
 * its status" and "a throwing verifier is a refusal" (they drove TheoClaw's deleted route with an
 * injected verifier, which the descriptor no longer takes).
 */

const ENV = { THEOCLAW_TEAMS_CLIENT_ID: 'teams-client-id', THEOCLAW_TEAMS_CLIENT_SECRET: 'teams-secret', THEOCLAW_TEAMS_TENANT_ID: '00000000-0000-4000-8000-000000000000' }
const ACTIVITY = JSON.stringify({ type: 'message', id: 'a-1', text: 'hello theo', from: { id: 'user-1' }, conversation: { id: 'c-1', conversationType: 'personal' }, serviceUrl: 'https://smba.trafficmanager.net/teams/' })

function rig(started = true) {
  const entry = resolvePlatforms(ENV).configured[0]!
  const adapter = offlineAdapter(ENV, 'teams')
  const delivered: string[] = []
  adapter.onInbound(async (event) => {
    delivered.push(event.text)
  })
  const lines: string[] = []
  const router = gatewayRouter({ channels: [{ descriptor: descriptorFor(entry.platform, entry.settings), adapter }], isStarted: () => started, write: (line) => lines.push(line) })
  return { delivered, lines, router }
}

const post = (headers: Record<string, string> = {}, body = ACTIVITY): Request => new Request('http://localhost/webhooks/teams', { method: 'POST', headers, body })

describe('the Teams webhook', () => {
  it('never delivers an activity the package verification rejected', async () => {
    const { delivered, router } = rig()
    expect((await router(post())).status).toBe(401)
    expect((await router(post({ authorization: 'Bearer not-a-jwt' }))).status).toBe(401)
    expect(delivered).toEqual([])
  })

  it('answers 503 before the platform starts', async () => {
    expect((await rig(false).router(post())).status).toBe(503)
  })

  it('answers 405 for a method the route does not take', async () => {
    const { router } = rig()
    expect((await router(new Request('http://localhost/webhooks/teams', { method: 'GET' }))).status).toBe(405)
  })

  it('refuses a body over 1 MiB with 413 and delivers nothing', async () => {
    const { delivered, router } = rig()
    expect((await router(post({}, 'x'.repeat(1024 * 1024 + 1)))).status).toBe(413)
    expect(delivered).toEqual([])
  })
})
