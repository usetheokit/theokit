import 'reflect-metadata'

import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { XAdapter } from '@theokit/gateway-x'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { adapterBuilders } from '../src/channels/adapter-factory.js'
import { startChannelLoop } from '../src/channels/channel-loop.js'
import type { ChannelLoop } from '../src/channels/channel-loop.js'
import { resolvePlatforms } from '../src/channels/platforms.js'
import { waitFor } from './fakes.js'

const ENV = {
  THEOCLAW_X_USER_ID: '999',
  THEOCLAW_X_USERNAME: 'thebot',
  THEOCLAW_X_CLIENT_ID: 'cid',
  THEOCLAW_X_CLIENT_SECRET: 'client-secret-value',
  THEOCLAW_X_REFRESH_TOKEN: 'refresh-token-value',
  THEOCLAW_X_ALLOW_FROM: 'alice, 42',
}

let loop: ChannelLoop | undefined
afterEach(async () => {
  await loop?.stopAll()
  loop = undefined
  vi.unstubAllGlobals()
})

interface Posted {
  readonly text: string
  readonly replyTo: string
}

/** A fake X API on the global `fetch`: one mention to deliver after the backlog, and the posts made. */
function fakeX(author: { id: string; username: string }): { readonly posts: Posted[] } {
  const posts: Posted[] = []
  vi.stubGlobal('fetch', async (input: string, init?: { method?: string; body?: string }) => {
    const url = new URL(String(input))
    const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
    if (url.pathname === '/2/oauth2/token') {
      return json({ access_token: 'access', expires_in: 7200, refresh_token: 'rotated-refresh-token' })
    }
    if (url.pathname === '/2/tweets' && init?.method === 'POST') {
      const body = JSON.parse(init.body ?? '{}') as { text: string; reply: { in_reply_to_tweet_id: string } }
      posts.push({ text: body.text, replyTo: body.reply.in_reply_to_tweet_id })
      return json({ data: { id: '300' } }, 201)
    }
    if (url.pathname === '/2/users/999/mentions') {
      if (!url.searchParams.has('since_id')) return json({ data: [], meta: { newest_id: '100' } })
      return json({
        data: [{ id: '101', text: '@thebot hello', author_id: author.id, conversation_id: '101' }],
        includes: { users: [{ id: author.id, username: author.username }] },
        meta: { newest_id: '101' },
      })
    }
    return json({}, 404)
  })
  return { posts }
}

async function run(author: { id: string; username: string }, stateDir: string): Promise<{ posts: Posted[]; replied: () => number }> {
  const { posts } = fakeX(author)
  const resolved = resolvePlatforms(ENV)
  const [builder] = adapterBuilders(resolved.configured)
  let adapter: XAdapter | undefined
  let handled = 0
  vi.stubEnv('THEOCLAW_STATE_DIR', stateDir)
  loop = startChannelLoop({
    platforms: [{ platform: 'x', build: () => (adapter = builder!.build() as XAdapter) }],
    handler: async (event, ctx) => {
      handled += 1
      await ctx.reply(`echo: ${event.text}`)
    },
    secrets: resolved.secrets,
    write: () => undefined,
  })
  await loop.ready
  expect(loop.failed).toEqual([])
  await adapter!.poll()
  return { posts, replied: () => handled }
}

describe('x', () => {
  it('needs every credential and a non-empty allowlist, and masks the secrets', () => {
    expect(resolvePlatforms({}).skipped.find((s) => s.platform === 'x')?.missing).toContain('THEOCLAW_X_USER_ID')
    expect(resolvePlatforms({ ...ENV, THEOCLAW_X_ALLOW_FROM: ' , ' }).skipped).toContainEqual({
      platform: 'x',
      missing: ['THEOCLAW_X_ALLOW_FROM'],
    })
    const resolved = resolvePlatforms({ ...ENV, THEOCLAW_X_BEARER_TOKEN: 'bearer-value', THEOCLAW_X_GUEST_DAILY_LIMIT: '3' })
    expect(resolved.configured).toContainEqual({
      platform: 'x',
      settings: {
        userId: '999',
        username: 'thebot',
        clientId: 'cid',
        clientSecret: 'client-secret-value',
        refreshToken: 'refresh-token-value',
        allowFrom: ['alice', '42'],
        bearerToken: 'bearer-value',
        guest: { dailyLimit: 3 },
      },
    })
    expect(resolved.secrets).toEqual(expect.arrayContaining(['client-secret-value', 'refresh-token-value', 'bearer-value']))
    expect(() => resolvePlatforms({ ...ENV, THEOCLAW_X_GUEST_DAILY_LIMIT: '0' })).toThrow(/positive integer/)
  })

  it('answers a mention from an allowlisted author with a public reply and keeps the rotated token', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'x-'))
    const { posts } = await run({ id: '7', username: 'alice' }, stateDir)
    await waitFor(() => posts.length > 0, 5000, 'the public reply')
    expect(posts[0]).toEqual({ text: 'echo: hello', replyTo: '101' })
    const file = join(stateDir, 'x-refresh-token')
    expect(readFileSync(file, 'utf8')).toBe('rotated-refresh-token')
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('gives an author outside the allowlist no reply', async () => {
    const { posts, replied } = await run({ id: '8', username: 'mallory' }, mkdtempSync(join(tmpdir(), 'x-')))
    expect(replied()).toBe(0)
    expect(posts).toEqual([])
  })
})
