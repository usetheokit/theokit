import { describe, expect, it, vi } from 'vitest'

import {
  handleChannelWebhook,
  parseChannelPath,
  isChannelPath,
} from '../../packages/theo/src/server/agent/channel-webhook.js'
import { telegram } from '../../packages/theo/src/server/webhook/providers/telegram.js'
import { discord } from '../../packages/theo/src/server/webhook/providers/discord.js'

/**
 * M27 (ADR-0041) — channel webhook routes with per-platform signature validation. Positive cases use
 * REAL signatures (Ed25519 for Discord, the echoed secret token for Telegram); negative cases prove
 * an invalid signature is rejected (401) — the security gate is the whole point.
 */

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Sign `timestamp+body` with a fresh Ed25519 key; return the public key + signature (hex). */
async function signDiscord(timestamp: string, body: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const msg = new TextEncoder().encode(timestamp + body)
  const sig = await crypto.subtle.sign('Ed25519', pair.privateKey, msg)
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey)
  return { publicKey: toHex(new Uint8Array(raw)), signature: toHex(new Uint8Array(sig)) }
}

describe('M27 — parseChannelPath', () => {
  it('extracts agent + platform', () => {
    expect(parseChannelPath('/api/agents/support/channels/slack/webhook')).toEqual({
      agent: 'support',
      platform: 'slack',
    })
    expect(isChannelPath('/api/agents/support/channels/slack/webhook')).toBe(true)
  })

  it('returns null for a non-channel path', () => {
    expect(parseChannelPath('/api/agents/support/mcp')).toBeNull()
    expect(isChannelPath('/api/agents/support/mcp')).toBe(false)
  })
})

describe('M27 — telegram validator', () => {
  it('accepts a matching secret token', async () => {
    const verify = telegram({ secretToken: 's3cr3t' })
    const req = new Request('http://x', {
      headers: { 'x-telegram-bot-api-secret-token': 's3cr3t' },
    })
    expect(await verify(req)).toEqual({ ok: true })
  })

  it('rejects a mismatched / missing token (negative case)', async () => {
    const verify = telegram({ secretToken: 's3cr3t' })
    const bad = new Request('http://x', { headers: { 'x-telegram-bot-api-secret-token': 'wrong' } })
    expect((await verify(bad)).ok).toBe(false)
    const missing = new Request('http://x')
    expect((await verify(missing)).ok).toBe(false)
  })
})

describe('M27 — discord validator (Ed25519)', () => {
  it('accepts a valid Ed25519 signature', async () => {
    const body = JSON.stringify({ type: 1 })
    const ts = '1700000000'
    const { publicKey, signature } = await signDiscord(ts, body)
    const verify = discord({ publicKey })
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': ts },
      body,
    })
    expect(await verify(req)).toEqual({ ok: true })
  })

  it('rejects a tampered body (negative case)', async () => {
    const ts = '1700000000'
    const { publicKey, signature } = await signDiscord(ts, JSON.stringify({ type: 1 }))
    const verify = discord({ publicKey })
    const tampered = new Request('http://x', {
      method: 'POST',
      headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': ts },
      body: JSON.stringify({ type: 2 }), // different body → signature no longer matches
    })
    expect((await verify(tampered)).ok).toBe(false)
  })
})

describe('M27 — handleChannelWebhook', () => {
  const path = '/api/agents/support/channels/telegram/webhook'

  it('validates the signature and hands off to onMessage (200)', async () => {
    const onMessage = vi.fn()
    const req = new Request(`http://x${path}`, {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'tok', 'content-type': 'application/json' },
      body: JSON.stringify({ message: { text: 'hi' } }),
    })
    const res = await handleChannelWebhook(req, path, {
      validators: { telegram: telegram({ secretToken: 'tok' }) },
      onMessage,
    })
    expect(res.status).toBe(200)
    expect(onMessage).toHaveBeenCalledWith({
      agent: 'support',
      platform: 'telegram',
      payload: { message: { text: 'hi' } },
    })
  })

  it('rejects an invalid signature with 401 and does NOT hand off (negative case)', async () => {
    const onMessage = vi.fn()
    const req = new Request(`http://x${path}`, {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'WRONG', 'content-type': 'application/json' },
      body: JSON.stringify({ message: { text: 'hi' } }),
    })
    const res = await handleChannelWebhook(req, path, {
      validators: { telegram: telegram({ secretToken: 'tok' }) },
      onMessage,
    })
    expect(res.status).toBe(401)
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('404s an unconfigured platform', async () => {
    const res = await handleChannelWebhook(
      new Request('http://x/api/agents/s/channels/discord/webhook', { method: 'POST', body: '{}' }),
      '/api/agents/s/channels/discord/webhook',
      { validators: { telegram: telegram({ secretToken: 't' }) }, onMessage: () => {} },
    )
    expect(res.status).toBe(404)
  })
})
