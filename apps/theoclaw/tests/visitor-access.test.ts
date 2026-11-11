import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { TRUSTED_IDENTITY_HEADER } from '../src/control-plane/trusted-proxy.js'
import { createWebchatRoutes } from '../src/webchat/routes.js'
import { visitorGate, visitorsCommand } from '../src/webchat/visitors.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function run(state: string, now: number, ...args: string[]): void {
  const stdout = new PassThrough()
  visitorsCommand(args, { env: { THEOCLAW_STATE_DIR: state }, homeDir: state, stdout, stderr: new PassThrough(), now: () => now })
}

describe('visitor access', () => {
  it('opens WebChat for a granted e-mail before expiry and refuses it after', async () => {
    const state = mkdtempSync(join(tmpdir(), 'visitors-'))
    dirs.push(state)
    let clock = 1_000_000
    const env = { THEOCLAW_STATE_DIR: state }
    const routes = createWebchatRoutes({
      token: 'webchat-token-value-0123456789abcdef',
      assetsDir: '/nonexistent',
      turnFor: () => {
        throw new Error('no turn expected')
      },
      trustedProxy: true,
      visitorGate: visitorGate(env, () => clock),
    })
    const post = (email: string): Promise<Response> =>
      routes(new Request('http://x/webchat/chat', { method: 'POST', headers: { [TRUSTED_IDENTITY_HEADER]: email }, body: '{}' }))

    expect((await post('Bob@Example.com')).status).toBe(400) // no grants file: proxy identity admitted as before
    run(state, clock, 'grant', 'bob@example.com', '1h')
    expect((await post('Bob@Example.com')).status).toBe(400)
    expect((await post('eve@example.com')).status).toBe(401)
    clock += 3_600_001
    expect((await post('bob@example.com')).status).toBe(401)
    run(state, clock, 'grant', 'bob@example.com', '1h')
    expect((await post('bob@example.com')).status).toBe(400)
    run(state, clock, 'revoke', 'bob@example.com')
    expect((await post('bob@example.com')).status).toBe(401)
  })

  it('refuses a past expiry', () => {
    const state = mkdtempSync(join(tmpdir(), 'visitors-'))
    dirs.push(state)
    expect(() => run(state, Date.parse('2026-01-01'), 'grant', 'a@b.co', '2000-01-01')).toThrow(/future/)
  })
})
