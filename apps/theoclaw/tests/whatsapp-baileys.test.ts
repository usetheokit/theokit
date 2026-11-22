import { WhatsAppAdapter } from '@theokit/gateway-whatsapp'
import { describe, expect, it } from 'vitest'

import { adapterBuilders } from '../src/channels/adapter-factory.js'
import { descriptorFor, resolvePlatforms } from '../src/channels/platforms.js'
import { renderQr } from '../src/channels/whatsapp-qr.js'
import { gatewayRouter } from './webhook-fixtures.js'

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

  it('builds the Baileys adapter and has no webhook route', async () => {
    const entry = resolvePlatforms({ THEOCLAW_WHATSAPP_BACKEND: 'baileys', THEOCLAW_STATE_DIR: '/state' }).configured[0]
    if (entry === undefined) throw new Error('not configured')
    const adapter = adapterBuilders([entry])[0]?.build()

    expect(adapter).toBeInstanceOf(WhatsAppAdapter)
    expect((adapter as WhatsAppAdapter).getBackend().kind).toBe('baileys')
    expect(descriptorFor(entry.platform, entry.settings).transport).toBe('socket')
    // Started or not, nothing for Meta to call: the gateway's handler routes webhook channels only.
    const router = gatewayRouter({ channels: [{ descriptor: descriptorFor(entry.platform, entry.settings), adapter: adapter! }], isStarted: () => true })
    expect((await router(new Request('http://localhost/webhooks/whatsapp', { method: 'POST', body: '{}' }))).status).toBe(404)
  })

  it('draws a QR as text', async () => {
    expect((await renderQr('hello')).split('\n').length).toBeGreaterThan(5)
  })
})
