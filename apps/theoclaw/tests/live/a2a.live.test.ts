/**
 * B-394 (OC-13) — two TheoClaw processes exchange a task over A2A on a real model.
 *
 * Instance B serves `/a2a` behind `THEOCLAW_A2A_TOKEN` and holds a note in its own tool root;
 * instance A, in a separate home, names B as a peer. A's `/control` agent calls `peer_b`, B answers
 * on a fresh read-only worker that reads the note, and A's answer carries the note's phrase, which
 * only B's tool root holds. Runs only with THEOCLAW_LIVE=1; without it the case skips and CI stays
 * offline. With it, a missing model or key fails naming it.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runControlTurn } from './support/control-turn.js'
import { throwUnlessFinished } from './support/turn-failed.js'
import { ENTRY, killInstance, startInstance, type StartedInstance, waitForListener, waitForStartLine } from './support/instance-process.js'

const LIVE = process.env.THEOCLAW_LIVE === '1'
const LIVE_TIMEOUT_MS = 300_000

/** The model and key from the environment, and the owner settings every start requires (B-371). */
function fixtureEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const variable of ['THEOCLAW_MODEL', 'THEOKIT_API_KEY', 'OPENROUTER_API_KEY']) {
    const value = process.env[variable]
    if (value !== undefined && value !== '') env[variable] = value
  }
  if (env.THEOCLAW_MODEL === undefined) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL')
  if ((env.THEOKIT_API_KEY ?? env.OPENROUTER_API_KEY) === undefined) throw new Error('THEOCLAW_LIVE=1 needs THEOKIT_API_KEY or OPENROUTER_API_KEY')
  if (!existsSync(ENTRY)) throw new Error(`${ENTRY} is missing: run pnpm --filter theoclaw run build`)
  return { ...env, THEOCLAW_OWNERS: 'telegram:owner', THEOCLAW_DM_POLICY: 'allowlist', THEOCLAW_MDNS: 'off' }
}

const answeredLines = (output: string): string[] => output.split('\n').filter((line) => line.includes('a2a: message/send answered'))

describe.skipIf(!LIVE)('A2A between two TheoClaw instances', () => {
  const children: StartedInstance[] = []
  const scratch: string[] = []

  function temp(name: string): string {
    const dir = mkdtempSync(join(tmpdir(), `theoclaw-a2a-${name}-`))
    scratch.push(dir)
    return dir
  }

  afterEach(async () => {
    for (const instance of children.splice(0)) await killInstance(instance.child)
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('two instances exchange a task over A2A on a real model for OC-13', { timeout: LIVE_TIMEOUT_MS }, async () => {
    const env = fixtureEnv()
    const cwd = temp('cwd')
    const homeB = temp('home-b')
    const homeA = temp('home-a')
    const tokenB = randomBytes(24).toString('base64url')

    const b = await startInstance({ profile: 'b', home: homeB, cwd, env: { ...env, THEOCLAW_A2A_TOKEN: tokenB } })
    children.push(b)
    await waitForStartLine(b, 'b')
    await waitForListener(b.child, b.port, 'b')
    const phrase = `harbor lantern ${randomBytes(4).toString('hex')}`
    const files = join(homeB, '.theokit', 'profiles', 'b', 'workspace', 'files')
    mkdirSync(files, { recursive: true })
    writeFileSync(join(files, 'note.txt'), `${phrase}\n`)

    const a = await startInstance({
      profile: 'a',
      home: homeA,
      cwd,
      env: { ...env, THEOCLAW_A2A_PEERS: `b=http://127.0.0.1:${b.port}`, THEOCLAW_A2A_PEER_TOKEN_B: tokenB },
    })
    children.push(a)
    await waitForStartLine(a, 'a')
    await waitForListener(a.child, a.port, 'a')

    const turn = await runControlTurn(
      a.port,
      a.token,
      'Make exactly one call to the peer_b tool asking it: "Use read_file to read note.txt and reply with its exact content". ' +
        'Do not read any file yourself. Then reply with the content peer b returned.',
      240_000,
    )
    throwUnlessFinished(turn, a.output(), [a.token])
    expect(turn.text).toContain(phrase)
    expect(answeredLines(b.output()), b.output()).toHaveLength(1)

    const wrong = await fetch(`http://127.0.0.1:${b.port}/a2a`, {
      method: 'POST',
      headers: { authorization: `Bearer wrong-${tokenB}` },
      body: '{}',
    })
    expect(wrong.status).toBe(401)
    const card = (await (await fetch(`http://127.0.0.1:${b.port}/.well-known/agent-card.json`)).json()) as { url: string }
    expect(card.url).toBe(`http://127.0.0.1:${b.port}/a2a`)
    expect(a.output()).not.toContain(tokenB)
    expect(b.output()).not.toContain(tokenB)
  })
})
