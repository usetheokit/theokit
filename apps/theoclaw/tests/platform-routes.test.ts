import type { BasePlatformAdapter, PlatformName } from '@theokit/gateway'
import type { TeamsActivityVerifierOptions } from '@theokit/gateway-teams'
import { describe, expect, it } from 'vitest'

import type { ChannelLoop, PlatformBuild, StartedPlatform } from '../src/channels/channel-loop.js'
import { startedRoute, webhookPlatform, withRoute } from '../src/webhooks/platform-routes.js'
import type { Handle, WebhookDeps, WebhookPlatform } from '../src/webhooks/platform-routes.js'
import type { TeamsVerifier } from '../src/webhooks/teams.js'
import { FakeAdapter } from './fakes.js'

/**
 * The webhook table and its two wrappers, tested directly rather than through the composed
 * router: which platforms have a route, what each route refuses to be built over, and how a
 * request finds the route of the adapter its runner started.
 */

const SMS_SETTINGS = {
  accountSid: 'AC-routes',
  authToken: 'sms-auth-token',
  fromNumber: '+12025550123',
  publicUrl: 'https://theoclaw.example.org/webhooks/sms',
}

const WHATSAPP_SETTINGS = {
  accessToken: 'wa-access-token',
  phoneNumberId: '1234',
  appSecret: 'wa-app-secret',
  verifyToken: 'wa-verify',
}

const TEAMS_SETTINGS = { clientId: 'teams-client', clientSecret: 'teams-secret', tenantId: 'teams-tenant' }

const refuseAll: TeamsVerifier = async () => ({ ok: false, reason: 'missing_authorization', message: 'no token' })

function deps(overrides: Partial<WebhookDeps> = {}): WebhookDeps {
  return { write: () => undefined, verifierFactory: () => refuseAll, ...overrides }
}

/** A loop whose `started` map holds exactly the adapters given. */
function loopWith(started: ReadonlyArray<readonly [PlatformName, BasePlatformAdapter]>): ChannelLoop {
  return {
    started: new Map(started.map(([platform, adapter]) => [platform, { adapter } as unknown as StartedPlatform])),
    failed: [],
    ready: Promise.resolve(),
    stopAll: async () => undefined,
  }
}

const ok: Handle = async () => new Response('routed', { status: 200 })

describe('webhookPlatform', () => {
  it.each(['telegram', 'discord', 'slack', 'matrix', 'mattermost', 'email'] as const)('has no webhook for %s', (platform) => {
    expect(webhookPlatform({ platform, settings: {} as never }, deps())).toBeUndefined()
  })

  it('builds the SMS route for POST only', () => {
    expect(webhookPlatform({ platform: 'sms', settings: SMS_SETTINGS }, deps())?.methods).toEqual(['POST'])
  })

  it('refuses to build the SMS route over an adapter that cannot verify a signature', () => {
    const sms = webhookPlatform({ platform: 'sms', settings: SMS_SETTINGS }, deps())
    expect(() => sms?.buildRoute(new FakeAdapter('sms'))).toThrow('the built adapter cannot verify a webhook signature')
  })

  it('builds the WhatsApp route for GET and POST', () => {
    expect(webhookPlatform({ platform: 'whatsapp', settings: WHATSAPP_SETTINGS }, deps())?.methods).toEqual(['GET', 'POST'])
  })

  it('refuses to build the WhatsApp route over an adapter that cannot convert an envelope', () => {
    const whatsapp = webhookPlatform({ platform: 'whatsapp', settings: WHATSAPP_SETTINGS }, deps())
    expect(() => whatsapp?.buildRoute(new FakeAdapter('whatsapp'))).toThrow('the built adapter cannot convert a webhook envelope')
  })

  it('builds the Teams verifier from the client id alone', () => {
    const given: TeamsActivityVerifierOptions[] = []
    webhookPlatform(
      { platform: 'teams', settings: TEAMS_SETTINGS },
      deps({
        verifierFactory: (options) => {
          given.push(options)
          return refuseAll
        },
      }),
    )
    expect(given).toEqual([{ clientId: 'teams-client' }])
  })

  it('answers 503 on Teams and says why when the verifier cannot be built', async () => {
    const lines: string[] = []
    const teams = webhookPlatform(
      { platform: 'teams', settings: TEAMS_SETTINGS },
      deps({
        write: (line) => void lines.push(line),
        verifierFactory: () => {
          throw new Error('no JWKS endpoint')
        },
      }),
    )
    const handle = teams?.buildRoute(new FakeAdapter('teams'))

    expect((await handle?.(new Request('http://localhost/webhooks/teams', { method: 'POST' })))?.status).toBe(503)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('teams: the activity verifier could not be built')
    expect(lines[0]).toContain('no JWKS endpoint')
  })
})

describe('withRoute', () => {
  const build: PlatformBuild = { platform: 'sms', build: () => new FakeAdapter('sms') }

  it('returns the build unchanged for a platform with no webhook', () => {
    expect(withRoute(build, undefined, new WeakMap())).toBe(build)
  })

  it('builds the route over the adapter it just built and records it', () => {
    const handles = new WeakMap<BasePlatformAdapter, Handle>()
    const seen: BasePlatformAdapter[] = []
    const webhook: WebhookPlatform = {
      methods: ['POST'],
      buildRoute: (adapter) => {
        seen.push(adapter)
        return ok
      },
    }

    const adapter = withRoute(build, webhook, handles).build()

    expect(seen).toEqual([adapter])
    expect(handles.get(adapter)).toBe(ok)
  })

  it('fails the build when the route cannot be built over the adapter', () => {
    const webhook: WebhookPlatform = {
      methods: ['POST'],
      buildRoute: () => {
        throw new Error('the built adapter cannot verify a webhook signature')
      },
    }
    expect(() => withRoute(build, webhook, new WeakMap()).build()).toThrow('the built adapter cannot verify a webhook signature')
  })
})

describe('startedRoute', () => {
  const request = (): Request => new Request('http://localhost/webhooks/sms', { method: 'POST' })

  it('answers 503 while the platform has not started', async () => {
    expect((await startedRoute(loopWith([]), 'sms', new WeakMap())(request())).status).toBe(503)
  })

  it('answers 503 when the started adapter has no route', async () => {
    const loop = loopWith([['sms', new FakeAdapter('sms')]])
    expect((await startedRoute(loop, 'sms', new WeakMap())(request())).status).toBe(503)
  })

  it('forwards to the route of the adapter the runner started', async () => {
    const adapter = new FakeAdapter('sms')
    const handles = new WeakMap<BasePlatformAdapter, Handle>([[adapter, ok]])
    const response = await startedRoute(loopWith([['sms', adapter]]), 'sms', handles)(request())

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('routed')
  })

  it('looks the adapter up per request, so a platform stopped since answers 503', async () => {
    const adapter = new FakeAdapter('sms')
    const started = new Map([['sms' as PlatformName, { adapter } as unknown as StartedPlatform]])
    const loop: ChannelLoop = { started, failed: [], ready: Promise.resolve(), stopAll: async () => undefined }
    const handle = startedRoute(loop, 'sms', new WeakMap([[adapter as BasePlatformAdapter, ok]]))

    expect((await handle(request())).status).toBe(200)
    started.delete('sms')
    expect((await handle(request())).status).toBe(503)
  })
})
