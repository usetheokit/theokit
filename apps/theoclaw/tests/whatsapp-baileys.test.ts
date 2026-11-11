import { WhatsAppAdapter } from '@theokit/gateway-whatsapp'
import { describe, expect, it } from 'vitest'

import { adapterBuilders } from '../src/channels/adapter-factory.js'
import { resolvePlatforms } from '../src/channels/platforms.js'
import { renderQr } from '../src/channels/whatsapp-qr.js'
import { webhookPlatform } from '../src/webhooks/platform-routes.js'

const deps = { write: () => undefined, verifierFactory: () => async () => undefined } as never

describe('THEOCLAW_WHATSAPP_BACKEND=baileys', () => {
  it('configures WhatsApp from a session directory under the state directory, with no secret', () => {
    const resolved = resolvePlatforms({ THEOCLAW_WHATSAPP_BACKEND: 'baileys', THEOCLAW_STATE_DIR: '/state' })

    expect(resolved.configured).toEqual([{ platform: 'whatsapp', settings: { sessionDir: '/state/whatsapp-session' } }])
    expect(resolved.secrets).toEqual([])
  })

  it('prefers THEOCLAW_WHATSAPP_SESSION_DIR and names what is missing otherwise', () => {
    const explicit = resolvePlatforms({ THEOCLAW_WHATSAPP_BACKEND: 'baileys', THEOCLAW_WHATSAPP_SESSION_DIR: '/s' })
    expect(explicit.configured[0]?.settings).toEqual({ sessionDir: '/s' })

    const none = resolvePlatforms({ THEOCLAW_WHATSAPP_BACKEND: 'baileys' })
    expect(none.skipped).toContainEqual({
      platform: 'whatsapp',
      missing: ['THEOCLAW_WHATSAPP_SESSION_DIR', 'THEOCLAW_STATE_DIR'],
    })
  })

  it('refuses an unknown backend and keeps cloud as the default', () => {
    expect(() => resolvePlatforms({ THEOCLAW_WHATSAPP_BACKEND: 'web' })).toThrow(/cloud or baileys/)
    expect(resolvePlatforms({ THEOCLAW_WHATSAPP_BACKEND: 'cloud' }).configured).toEqual([])
  })

  it('builds the Baileys adapter and has no webhook route', () => {
    const entry = resolvePlatforms({ THEOCLAW_WHATSAPP_BACKEND: 'baileys', THEOCLAW_STATE_DIR: '/state' }).configured[0]
    if (entry === undefined) throw new Error('not configured')
    const adapter = adapterBuilders([entry])[0]?.build()

    expect(adapter).toBeInstanceOf(WhatsAppAdapter)
    expect((adapter as WhatsAppAdapter).getBackend().kind).toBe('baileys')
    expect(webhookPlatform(entry as Parameters<typeof webhookPlatform>[0], deps)).toBeUndefined()
  })

  it('draws a QR as text', async () => {
    expect((await renderQr('hello')).split('\n').length).toBeGreaterThan(5)
  })
})
