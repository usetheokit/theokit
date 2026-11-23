import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createHostedChat, hashedSessionScope } from '../../src/server/http/index.js'

async function setup(extra: Partial<Parameters<typeof createHostedChat>[0]> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hosted-chat-'))
  await writeFile(join(dir, 'app.js'), 'console.log(1)')
  const seen: Array<{ message: string; chatId: string; signal: AbortSignal }> = []
  const handler = createHostedChat({
    route: '/talk',
    assetsDir: dir,
    maxBodyBytes: 200,
    title: 'Talk',
    auth: (request) =>
      request.headers.get('x-ok') === null
        ? new Response(null, { status: 401 })
        : { identity: request.headers.get('x-ok') ?? '' },
    createRun: (message, chatId, signal) => {
      seen.push({ message, chatId, signal })
      return (async function* () {
        yield { type: 'done', result: 'ok', durationMs: 0, usage: {} } as never
      })()
    },
    sessionScope: hashedSessionScope,
    ...extra,
  })
  const post = (
    body: string,
    headers: Record<string, string> = { 'x-ok': 'bob' },
    signal?: AbortSignal,
  ) =>
    handler(
      new Request('http://x/talk/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
        signal,
      }),
    )
  return { handler, post, seen }
}

describe('createHostedChat', () => {
  it('serves the shell with a CSP and the named assets only', async () => {
    const { handler } = await setup()
    const page = await handler(new Request('http://x/talk'))
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(await page.text()).toContain('/talk/assets/app.js')
    expect((await handler(new Request('http://x/talk/assets/app.js'))).status).toBe(200)
    expect((await handler(new Request('http://x/talk/assets/../x'))).status).toBe(404)
    expect((await handler(new Request('http://x/talk/assets/app.css'))).status).toBe(404)
    const sandbox = await handler(new Request('http://x/talk/sandbox'))
    expect(sandbox.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
    expect((await handler(new Request('http://x/other'))).status).toBe(404)
  })

  it('answers 503 when the bundle is missing', async () => {
    const { handler } = await setup({
      assetsDir: join(tmpdir(), 'no-such-dir-hosted'),
      missingBundleMessage: 'build it\n',
    })
    const res = await handler(new Request('http://x/talk'))
    expect(res.status).toBe(503)
    expect(await res.text()).toBe('build it\n')
  })

  it('refuses before reading the body and creates no run', async () => {
    const { post, seen } = await setup()
    expect((await post('{"message":"hi","id":"c1"}', {})).status).toBe(401)
    expect(seen).toHaveLength(0)
  })

  it('caps the body and validates the chat id before any run', async () => {
    const { post, seen } = await setup()
    expect((await post(JSON.stringify({ message: 'x'.repeat(300), id: 'c' }))).status).toBe(413)
    const bad = await post(JSON.stringify({ message: 'hi', id: '../x' }))
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('chat_id_invalid')
    expect((await post(JSON.stringify({ message: 'hi' }))).status).toBe(400)
    expect(seen).toHaveLength(0)
  })

  it('scopes the chat id under the identity', async () => {
    const { post, seen } = await setup()
    const res = await post(JSON.stringify({ message: 'hi', id: 'c1' }))
    expect(res.status).toBe(200)
    await res.text()
    expect(seen[0]?.chatId).toBe(`${await hashedSessionScope('bob')}c1`)
    expect(await hashedSessionScope('bob')).not.toBe(await hashedSessionScope('amy'))
  })

  it('stops the run when the client leaves', async () => {
    const { post, seen } = await setup()
    const ctl = new AbortController()
    const res = await post(
      JSON.stringify({ message: 'hi', id: 'c1' }),
      { 'x-ok': 'bob' },
      ctl.signal,
    )
    ctl.abort()
    await res.body?.cancel().catch(() => undefined)
    expect(seen[0]?.signal.aborted).toBe(true)
  })
})
