/**
 * B-394 (OC-13) — the A2A settings: `THEOCLAW_A2A_TOKEN` switches the `/a2a` route on,
 * `THEOCLAW_A2A_PEERS` names the peers and `THEOCLAW_A2A_PEER_TOKEN_<NAME>` holds each one's token.
 * A bad value stops the start naming the variable and never the token; the tokens join the masked
 * values and the security audit's weak-token check.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { A2APeer } from '../src/a2a/a2a-settings.js'
import { peerTools } from '../src/a2a/peer-tools.js'
import { createTheoClawAgent, theoClawAgentOptions } from '../src/agent/create-agent.js'
import type { TurnAgent } from '../src/agent-port.js'
import { controlAgentToolOptions } from '../src/tools/tool-registry.js'
import type { AgentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { advertisedTools, startModelStub } from './model-stub.js'
import type { ModelStub } from './model-stub.js'

import { a2aLines, readA2ASettings } from '../src/a2a/a2a-settings.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { processSecrets } from '../src/secrets.js'
import { auditConfiguration } from '../src/security-audit.js'
import { cleanScratch, scratchDir } from './support/cli-harness.js'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  cleanScratch()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

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

const PEERS: readonly A2APeer[] = [
  { name: 'b', baseUrl: 'http://127.0.0.1:1', token: PEER_B },
  { name: 'c', baseUrl: 'http://127.0.0.1:2', token: PEER_C },
]

/** One agent turn against the stub, drained so every request it makes is recorded. */
async function turn(agent: TurnAgent & Partial<AsyncDisposable>, prompt: string): Promise<void> {
  try {
    const run = await agent.send(prompt)
    for await (const _event of run.stream()) {
      // Drained, so the run proceeds; the stub records what each request carried.
    }
    await run.wait()
  } finally {
    await agent[Symbol.asyncDispose]?.()
  }
}

describe('the peer tools', () => {
  it('gives the control agent one peer tool per peer and never a chat agent or a worker', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const tools = resolveToolSettings({}, workspace.path, { detect: () => ({ ok: true, bin: '/usr/bin/bwrap' }), warn: () => undefined })
    const stub: ModelStub = await startModelStub([
      { toolCalls: [{ name: 'delegate', args: { agent: 'worker', task: 'say ok' } }] },
      { text: 'worker ok' },
      { text: 'control done' },
      { text: 'chat reply' },
    ])
    cleanups.push(() => stub.close())
    const model = { id: 'lmstudio/stub', url: stub.url }
    const build = (toolOptions: AgentToolOptions): Promise<TurnAgent> => createTheoClawAgent(theoClawAgentOptions({ model, apiKey: 'stub-key', toolOptions }))

    await turn(await build(controlAgentToolOptions(tools, build, peerTools(PEERS))), 'delegate something')
    // A chat agent is built with no tool options at all (control-plane/agent-factory.ts).
    await turn(await createTheoClawAgent(theoClawAgentOptions({ model, apiKey: 'stub-key' })), 'hello')

    const control = advertisedTools(stub.requests[0])
    expect(control.filter((name) => name.startsWith('peer_')).sort()).toEqual(['peer_b', 'peer_c'])
    const worker = advertisedTools(stub.requests[1])
    expect(worker.length).toBeGreaterThan(0)
    expect(worker.some((name) => name.startsWith('peer_'))).toBe(false)
    expect(advertisedTools(stub.requests[3]).some((name) => name.startsWith('peer_'))).toBe(false)
  })

  it('a peer tool names the peer when the connection is refused', async () => {
    const refused = new TypeError('fetch failed')
    const [tool] = peerTools([PEERS[0] as A2APeer], { fetchImpl: () => Promise.reject(refused) })
    const call = tool?.handler({ message: 'hi' })
    await expect(call).rejects.toThrow('A2A call to "peer_b" failed: fetch failed')
    await expect(call).rejects.toMatchObject({ cause: refused })

    const controller = new AbortController()
    const reason = new Error('the turn was cancelled')
    const [waiting] = peerTools([PEERS[0] as A2APeer], {
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error)
          })
        }),
    })
    const cancelled = waiting?.handler({ message: 'hi' }, { signal: controller.signal })
    controller.abort(reason)
    await expect(cancelled).rejects.toBe(reason)
  })

  it('a peer tool reports a peer that answers too late', async () => {
    const [tool] = peerTools([PEERS[0] as A2APeer], {
      timeoutMs: 50,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error)
          })
        }),
    })
    await expect(tool?.handler({ message: 'hi' })).rejects.toThrow('A2A call to "peer_b" failed: no answer within 50 ms')
  })
})
