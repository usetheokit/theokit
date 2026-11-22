import { describe, expect, it } from 'vitest'

import { statusForDeliver } from '@theokit/gateway'
import { normalizeTeamsActivity } from '@theokit/gateway-teams'
import type { ChannelDescriptor, MessageEvent } from '@theokit/gateway'

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

  it('answers 404 for a platform that is not configured', async () => {
    expect((await rig().router(new Request('http://localhost/webhooks/line', { method: 'POST', body: '{}' }))).status).toBe(404)
  })
})

/*
 * No verifier injection seam exists: `teamsChannel.webhook.handle` builds `teamsActivityVerifier`
 * from the client id inside the package and the descriptor takes no verifier option, so a valid
 * connector token cannot be forged offline. Mitigation: the delivery and acknowledgement half is
 * driven through a stand-in `handle` that stands where verification passed and answers by the same
 * `statusForDeliver` mapping over the real Teams adapter's `deliver`; refusals stay covered above
 * through the real descriptor.
 */
function verifiedRig(subscribe: ((event: MessageEvent) => Promise<void>) | undefined) {
  const entry = resolvePlatforms(ENV).configured[0]!
  const adapter = offlineAdapter(ENV, 'teams')
  if (subscribe !== undefined) adapter.onInbound(subscribe)
  const real = descriptorFor(entry.platform, entry.settings)
  const descriptor: ChannelDescriptor = {
    ...real,
    webhook: {
      ...real.webhook!,
      handle: async (target, request) => {
        const activity = JSON.parse(request.rawBody) as Parameters<typeof normalizeTeamsActivity>[0]
        if (activity.type !== 'message') return { status: 200 }
        const event = normalizeTeamsActivity(activity) as unknown as MessageEvent
        const outcome = await (target as unknown as { deliver(e: MessageEvent): Promise<'ok' | 'no_handler' | 'handler_threw'> }).deliver(event)
        return { status: statusForDeliver([outcome]) }
      },
    },
  }
  return gatewayRouter({ channels: [{ descriptor, adapter }], isStarted: () => true })
}

describe('the Teams delivery outcomes', () => {
  it('acknowledges a delivered message with 200 and hands it to the handler', async () => {
    const delivered: string[] = []
    const router = verifiedRig(async (event) => {
      delivered.push(event.text)
    })
    expect((await router(post())).status).toBe(200)
    expect(delivered).toEqual(['hello theo'])
  })

  it('acknowledges a non message activity without delivering it', async () => {
    const delivered: string[] = []
    const router = verifiedRig(async (event) => {
      delivered.push(event.text)
    })
    expect((await router(post({}, JSON.stringify({ type: 'conversationUpdate' })))).status).toBe(200)
    expect(delivered).toEqual([])
  })

  it('answers 500 on handler_threw so Teams redelivers', async () => {
    const router = verifiedRig(async () => {
      throw new Error('handler exploded')
    })
    expect((await router(post())).status).toBe(500)
  })

  it('answers 503 on no_handler so Teams retries', async () => {
    expect((await verifiedRig(undefined)(post())).status).toBe(503)
  })
})
