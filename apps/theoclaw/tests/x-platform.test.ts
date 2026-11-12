import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { MessageEvent } from '@theokit/gateway'
import { XAdapter } from '@theokit/gateway-x'

import { adapterBuilders, X_REFRESH_TOKEN_FILE } from '../src/channels/adapter-factory.js'
import type { PlatformSettings } from '../src/channels/platforms.js'

const SETTINGS: PlatformSettings<'x'> = {
  userId: '1',
  username: 'bot',
  clientId: 'cid',
  clientSecret: 'secret',
  refreshToken: 'old-refresh',
  allowFrom: 'alice',
}

interface Posted {
  readonly text: string
  readonly inReplyTo: string
}

/** A fake X API: one mention from each author, the token endpoint rotating the refresh token. */
function fakeX(): { readonly posted: Posted[]; readonly fetch: NonNullable<ConstructorParameters<typeof XAdapter>[0]['fetch']> } {
  const posted: Posted[] = []
  let polled = false
  const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) })
  return {
    posted,
    fetch: async (url, init) => {
      if (url.includes('/2/oauth2/token')) return json(200, { access_token: 'at', expires_in: 7200, refresh_token: 'new-refresh' })
      if (url.includes('/2/users/1/mentions')) {
        if (!polled) {
          polled = true
          return json(200, { meta: { newest_id: '5' } })
        }
        return json(200, {
          data: [
            { id: '10', text: '@bot hi', author_id: '7', conversation_id: '10' },
            { id: '11', text: '@bot hello', author_id: '8', conversation_id: '11' },
          ],
          includes: { users: [{ id: '7', username: 'alice' }, { id: '8', username: 'mallory' }] },
          meta: { newest_id: '11' },
        })
      }
      if (url.endsWith('/2/tweets') && init.method === 'POST') {
        const body = JSON.parse(init.body ?? '{}') as { text: string; reply: { in_reply_to_tweet_id: string } }
        posted.push({ text: body.text, inReplyTo: body.reply.in_reply_to_tweet_id })
        return json(201, { data: { id: '99' } })
      }
      return json(404, {})
    },
  }
}

describe('X platform', () => {
  it('replies publicly to an allowlisted author only, and keeps the rotated refresh token', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'x-state-'))
    const [entry] = adapterBuilders([{ platform: 'x', settings: SETTINGS }], { stateDir })
    const adapter = entry?.build()
    expect(adapter).toBeInstanceOf(XAdapter)
    const x = adapter as XAdapter
    const api = fakeX()
    // The adapter's fetch seam is an option fixed at construction; rebuild with it through xOptions.
    const { xOptions } = await import('../src/channels/adapter-factory.js')
    const withFetch = new XAdapter({ ...xOptions(SETTINGS, { stateDir }), fetch: api.fetch, pollIntervalMs: 0 })
    const events: MessageEvent[] = []
    withFetch.onInbound(async (event) => {
      events.push(event)
      await withFetch.sendMessage({ channel: event.channel, text: 'pong', replyTo: event.id })
    })
    expect(await withFetch.connect()).toBe(true)
    await withFetch.poll()
    await withFetch.disconnect()
    await x.disconnect()

    expect(events.map((event) => event.sender.id)).toEqual(['7'])
    expect(api.posted).toEqual([{ text: 'pong', inReplyTo: '10' }])
    expect(readFileSync(join(stateDir, X_REFRESH_TOKEN_FILE), 'utf8')).toBe('new-refresh')
  })

  it('starts from the saved refresh token when one exists', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'x-state-'))
    const { xOptions } = await import('../src/channels/adapter-factory.js')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(stateDir, X_REFRESH_TOKEN_FILE), 'saved\n')
    expect(xOptions(SETTINGS, { stateDir }).refreshToken).toBe('saved')
    expect(xOptions(SETTINGS).refreshToken).toBe('old-refresh')
    expect(xOptions(SETTINGS).allowFrom).toEqual(['alice'])
  })
})
