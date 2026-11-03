/**
 * B-394 (OC-13) — the A2A settings: `THEOCLAW_A2A_TOKEN` switches the `/a2a` route on,
 * `THEOCLAW_A2A_PEERS` names the peers and `THEOCLAW_A2A_PEER_TOKEN_<NAME>` holds each one's token.
 * A bad value stops the start naming the variable and never the token; the tokens join the masked
 * values and the security audit's weak-token check.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { a2aLines, readA2ASettings } from '../src/a2a/a2a-settings.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { processSecrets } from '../src/secrets.js'
import { auditConfiguration } from '../src/security-audit.js'
import { cleanScratch, scratchDir } from './support/cli-harness.js'

afterEach(cleanScratch)

const INBOUND = 'inbound-token-0123456789abcdef0123456789'
const PEER_B = 'peer-b-token-0123456789abcdef0123456789ab'
const PEER_C = 'peer-c-token-0123456789abcdef0123456789ab'

function refusal(env: Record<string, string>): TheoClawConfigError {
  try {
    readA2ASettings(env)
  } catch (error) {
    expect(error).toBeInstanceOf(TheoClawConfigError)
    return error as TheoClawConfigError
  }
  throw new Error(`readA2ASettings accepted ${JSON.stringify(env)}`)
}

describe('readA2ASettings', () => {
  it('refuses a malformed peer, a repeated name or a missing peer token naming the variable and not the token', () => {
    for (const peers of [
      'b',
      'B=http://127.0.0.1:1',
      'b=ftp://127.0.0.1:1',
      'b=http://127.0.0.1:1?x=1',
      'b=http://127.0.0.1:1,b=http://127.0.0.1:2',
      'b=not a url',
      '=http://127.0.0.1:1',
      `${'b'.repeat(33)}=http://127.0.0.1:1`,
      'b=https://user:pass@peer.example', // trufflehog:ignore -- placeholder credential the reader must refuse
      'b=http://0.0.0.0:7300',
    ]) {
      const error = refusal({ THEOCLAW_A2A_PEERS: peers, THEOCLAW_A2A_PEER_TOKEN_B: PEER_B })
      expect(error.variable).toBe('THEOCLAW_A2A_PEERS')
      expect(error.message).toContain('THEOCLAW_A2A_PEERS')
      expect(error.message).not.toContain(PEER_B)
    }

    const missing = refusal({ THEOCLAW_A2A_PEERS: 'b=http://127.0.0.1:1' })
    expect(missing.variable).toBe('THEOCLAW_A2A_PEER_TOKEN_B')
    expect(missing.message).toContain('THEOCLAW_A2A_PEER_TOKEN_B')

    const short = 'x'.repeat(31)
    const shortPeer = refusal({
      THEOCLAW_A2A_PEERS: 'b=http://127.0.0.1:1',
      THEOCLAW_A2A_PEER_TOKEN_B: short,
    })
    expect(shortPeer.variable).toBe('THEOCLAW_A2A_PEER_TOKEN_B')
    expect(shortPeer.message).not.toContain(short)

    const shortInbound = refusal({ THEOCLAW_A2A_TOKEN: short })
    expect(shortInbound.variable).toBe('THEOCLAW_A2A_TOKEN')
    expect(shortInbound.message).not.toContain(short)
  })

  it('refuses a plain-http peer that is not on the loopback', () => {
    const error = refusal({
      THEOCLAW_A2A_PEERS: 'b=http://192.168.1.20:7300',
      THEOCLAW_A2A_PEER_TOKEN_B: PEER_B,
    })
    expect(error.variable).toBe('THEOCLAW_A2A_PEERS')
    expect(error.message).toContain('https')

    for (const url of [
      'http://127.0.0.1:7300',
      'http://[::1]:7300',
      'http://localhost:7300',
      'https://peer.example',
    ]) {
      const settings = readA2ASettings({
        THEOCLAW_A2A_PEERS: `b=${url}`,
        THEOCLAW_A2A_PEER_TOKEN_B: PEER_B,
      })
      expect(settings.peers.map((peer) => peer.name)).toEqual(['b'])
    }
  })

  it('refuses an empty peer entry', () => {
    const trailing = refusal({
      THEOCLAW_A2A_PEERS: 'b=http://127.0.0.1:1,',
      THEOCLAW_A2A_PEER_TOKEN_B: PEER_B,
    })
    expect(trailing.variable).toBe('THEOCLAW_A2A_PEERS')
    expect(trailing.message).toContain('entry 2')

    const leading = refusal({
      THEOCLAW_A2A_PEERS: ',b=http://127.0.0.1:1',
      THEOCLAW_A2A_PEER_TOKEN_B: PEER_B,
    })
    expect(leading.message).toContain('entry 1')

    const doubled = refusal({
      THEOCLAW_A2A_PEERS: 'b=http://127.0.0.1:1,,c=http://127.0.0.1:2',
      THEOCLAW_A2A_PEER_TOKEN_B: PEER_B,
      THEOCLAW_A2A_PEER_TOKEN_C: PEER_C,
    })
    expect(doubled.message).toContain('entry 2')
  })

  it('reads peers and the inbound token and prints the a2a lines', () => {
    const settings = readA2ASettings({
      THEOCLAW_A2A_TOKEN: INBOUND,
      THEOCLAW_A2A_PEERS: ' b=http://127.0.0.1:7300/ , c=https://peer.example/base/ ',
      THEOCLAW_A2A_PEER_TOKEN_B: PEER_B,
      THEOCLAW_A2A_PEER_TOKEN_C: PEER_C,
    })
    expect(settings.token).toBe(INBOUND)
    expect(settings.peers).toEqual([
      { name: 'b', baseUrl: 'http://127.0.0.1:7300', token: PEER_B },
      { name: 'c', baseUrl: 'https://peer.example/base', token: PEER_C },
    ])
    const lines = a2aLines(settings)
    expect(lines).toEqual(['a2a: serving /a2a (THEOCLAW_A2A_TOKEN set)', 'a2a: peers b, c'])
    expect(lines.join('\n')).not.toContain(PEER_B)
    expect(lines.join('\n')).not.toContain('127.0.0.1')

    const off = readA2ASettings({})
    expect(off).toEqual({ token: undefined, peers: [] })
    expect(a2aLines(off)).toEqual(['a2a: off (THEOCLAW_A2A_TOKEN unset)'])
    expect(readA2ASettings({ THEOCLAW_A2A_PEERS: '' }).peers).toEqual([])
  })

  it('masks the inbound and peer tokens', () => {
    const settings = readA2ASettings({
      THEOCLAW_A2A_TOKEN: INBOUND,
      THEOCLAW_A2A_PEERS: 'b=http://127.0.0.1:1,c=http://127.0.0.1:2',
      THEOCLAW_A2A_PEER_TOKEN_B: PEER_B,
      THEOCLAW_A2A_PEER_TOKEN_C: PEER_C,
    })
    const secrets = processSecrets(
      { env: {} },
      { controlToken: undefined, webchatToken: undefined },
      { secrets: [] },
      undefined,
      settings,
    )
    expect(secrets).toEqual(expect.arrayContaining([INBOUND, PEER_B, PEER_C]))
  })

  it('audits a short A2A token', () => {
    const dir = join(scratchDir(), 'theoclaw')
    mkdirSync(dir, { recursive: true })
    chmodSync(dir, 0o700)
    const path = join(dir, 'theoclaw.env')
    writeFileSync(
      path,
      `THEOCLAW_A2A_TOKEN="${'a'.repeat(20)}"\nTHEOCLAW_A2A_PEER_TOKEN_B="${'b'.repeat(20)}"\n`,
    )
    chmodSync(path, 0o600)
    const findings = auditConfiguration({ THEOCLAW_CONFIG: path }, dir).filter(
      (finding) => finding.id === 'SA-006',
    )
    expect(findings.map((finding) => finding.message).join('\n')).toContain('THEOCLAW_A2A_TOKEN')
    expect(findings.map((finding) => finding.message).join('\n')).toContain(
      'THEOCLAW_A2A_PEER_TOKEN_B',
    )
    expect(JSON.stringify(findings)).not.toContain('a'.repeat(20))
  })
})
