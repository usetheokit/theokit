import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { createWebchatRoutes } from '../src/webchat/routes.js'
import { isGranted, visitorsPath } from '../src/webchat/visitors.js'
import { TRUSTED_IDENTITY_HEADER } from '../src/control-plane/trusted-proxy.js'
import { cleanScratch, harness } from './support/cli-harness.js'

afterEach(cleanScratch)

describe('visitor grants', () => {
  it('grants an e-mail through the CLI and expires it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'visitors-'))
    const v = harness()
    const env = { THEOCLAW_STATE_DIR: dir }
    expect(await runCli(['visitors', 'grant', 'Ann@Example.com', '--for', '1h'], { ...v.io, env })).toBe(0)
    const file = visitorsPath(env)
    expect(isGranted(file, 'ann@example.com')).toBe(true)
    expect(isGranted(file, 'ann@example.com', Date.now() + 2 * 3_600_000)).toBe(false)
    expect(isGranted(file, 'bob@example.com')).toBe(false)
    await runCli(['visitors', 'revoke', 'ann@example.com'], { ...v.io, env })
    expect(isGranted(file, 'ann@example.com')).toBe(false)
  })

  it('opens the chat post before expiry and refuses it after', async () => {
    let now = Date.now()
    const grants = new Map([['ann@example.com', now + 1000]])
    const routes = createWebchatRoutes({
      token: 'x'.repeat(32),
      trustedProxy: true,
      assetsDir: tmpdir(),
      turnFor: () => {
        throw new Error('no turn')
      },
      visitorAllowed: (who) => (grants.get(who) ?? 0) > now,
    })
    const post = (who: string): Promise<Response> =>
      routes(
        new Request('http://x/webchat/chat', {
          method: 'POST',
          headers: { [TRUSTED_IDENTITY_HEADER]: who, 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
    expect((await post('ann@example.com')).status).toBe(400)
    expect((await post('eve@example.com')).status).toBe(403)
    now += 2000
    expect((await post('ann@example.com')).status).toBe(403)
  })
})
