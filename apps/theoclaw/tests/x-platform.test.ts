import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { XAdapter } from '@theokit/gateway-x'

import { adapterBuilders, X_REFRESH_TOKEN_FILE, xOptions } from '../src/channels/adapter-factory.js'
import type { PlatformBuild } from '../src/channels/channel-loop.js'
import type { ConfiguredPlatform, PlatformSettings } from '../src/channels/platforms.js'
import { composeTheoClaw } from '../src/composition.js'
import { WORKSPACE } from './composition-fixtures.js'
import { FakeAgent, assistant, finished, waitFor } from './fakes.js'

const SETTINGS: PlatformSettings<'x'> = {
  userId: '1',
  username: 'bot',
  clientId: 'cid',
  clientSecret: 'secret',
  refreshToken: 'old-refresh',
  allowFrom: 'alice',
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status })

/** A fake X API behind the global fetch the adapter defaults to: the token endpoint rotates the refresh token. */
function stubXApi(): string[] {
  const replies: string[] = []
  let polled = false
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
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
        includes: {
          users: [
            { id: '7', username: 'alice' },
            { id: '8', username: 'mallory' },
          ],
        },
        meta: { newest_id: '11' },
      })
    }
    if (url.endsWith('/2/tweets') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { text: string; reply: { in_reply_to_tweet_id: string } }
      replies.push(`${body.reply.in_reply_to_tweet_id}:${body.text}`)
      return json(201, { data: { id: '99' } })
    }
    return json(404, {})
  })
  return replies
}

afterEach(() => vi.unstubAllGlobals())

describe('X platform', () => {
  it('answers a mention from an allowlisted author with a public reply, through composition, and no other', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'x-state-'))
    const replies = stubXApi()
    const agent = Object.assign(new FakeAgent({ frames: [assistant('pong'), finished()] }), { dispose: async () => undefined })
    let adapter: XAdapter | undefined
    const builders = (configured: readonly ConfiguredPlatform[]): PlatformBuild[] =>
      adapterBuilders(configured, { stateDir }).map((entry) => ({
        platform: entry.platform,
        build: () => {
          const built = entry.build()
          adapter = built as XAdapter
          return built
        },
      }))
    const { loop } = composeTheoClaw({
      env: {
        THEOCLAW_PORT: '0',
        THEOCLAW_MODEL: 'test-model',
        OPENROUTER_API_KEY: 'openrouter-key-value',
        THEOCLAW_OWNERS: 'line:U-owner',
        THEOCLAW_WORKSPACE: WORKSPACE,
        THEOCLAW_STATE_DIR: stateDir,
        THEOCLAW_X_USER_ID: '1',
        THEOCLAW_X_USERNAME: 'bot',
        THEOCLAW_X_CLIENT_ID: 'cid',
        THEOCLAW_X_CLIENT_SECRET: 'secret',
        THEOCLAW_X_REFRESH_TOKEN: 'old-refresh',
        // Only X_ALLOW_FROM admits the author: the owner is on another platform, with no THEOCLAW_ALLOWLIST entry.
        THEOCLAW_X_ALLOW_FROM: 'alice',
      },
      agentFactory: () => agent,
      getOrCreate: async () => agent,
      builders,
      write: () => undefined,
    })
    await loop.ready
    expect(adapter).toBeInstanceOf(XAdapter)

    await adapter?.poll()
    await waitFor(() => replies.length > 0, 2000, 'the public reply to be posted')
    await loop.stopAll()

    expect(replies).toEqual(['10:pong'])
    expect(agent.sent).toEqual(['hi'])
    expect(readFileSync(join(stateDir, X_REFRESH_TOKEN_FILE), 'utf8')).toBe('new-refresh')
  })

  it('starts from the saved refresh token when one exists', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'x-state-'))
    writeFileSync(join(stateDir, X_REFRESH_TOKEN_FILE), 'saved\n')
    expect(xOptions(SETTINGS, { stateDir }).refreshToken).toBe('saved')
    expect(xOptions(SETTINGS).refreshToken).toBe('old-refresh')
    expect(xOptions(SETTINGS).allowFrom).toEqual(['alice'])
  })
})
