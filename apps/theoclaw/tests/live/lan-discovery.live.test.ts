import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { hostname, networkInterfaces } from 'node:os'
import { performance } from 'node:perf_hooks'

import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { type RunningTheoClaw, startTheoClaw } from '../../src/composition.js'
import { createAgentFactory } from '../../src/control-plane/agent-factory.js'
import { serviceName } from '../../src/discovery/lan-announcer.js'
import {
  expectNoSrv,
  type MdnsSocket,
  openMdnsSocket,
  querySrv,
  startControlResponder,
  waitForSrv,
} from './support/mdns-client.js'

/**
 * OC-25 (B-513) against a real multicast socket and a real model: TheoClaw is started in-process
 * through `startTheoClaw` with the real bonjour-service default, and the test watches the mDNS group
 * from a socket of its own. Runs only with THEOCLAW_LIVE=1 and the model settings in the
 * environment; without the flag it skips, so CI stays offline.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const FIRST_ANNOUNCEMENT_MS = 3000
const ANSWER_MS = 150
const QUERY_GAP_MS = 700
const SILENCE_MS = 2000
const EXIT_MS = 15_000

/** Private addresses first: on a host with a public interface the test must not open a port to the internet. */
function lanAddress(): string {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
  const isPrivate = (address: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)
  const chosen = addresses.find(isPrivate) ?? addresses[0]
  if (chosen === undefined) throw new Error('no non-internal IPv4 address on this host; the LAN tests cannot run')
  return chosen
}

interface Started {
  readonly running: RunningTheoClaw
  readonly token: string
  readonly called: number
  readonly resolved: number
  readonly signals: EventEmitter
  readonly exited: Promise<number>
  stopped: boolean
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  const failures: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new Error(`teardown failed: ${failures.map(String).join('; ')}`)
})

async function openSocket(): Promise<MdnsSocket> {
  const socket = await openMdnsSocket()
  cleanups.push(() => socket.close())
  return socket
}

function withinMs<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not happen within ${ms} ms`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

async function stop(started: Started): Promise<void> {
  started.stopped = true
  started.signals.emit('SIGTERM')
  expect(await withinMs(started.exited, EXIT_MS, 'the exit after SIGTERM')).toBe(0)
}

async function start(lan: boolean): Promise<Started> {
  const model = process.env.THEOCLAW_MODEL
  const modelKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY
  if (!model || !modelKey) {
    throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY')
  }
  const token = randomBytes(24).toString('base64url')
  const env: Record<string, string | undefined> = {
    THEOCLAW_MODEL: model,
    ...(process.env.THEOKIT_API_KEY ? { THEOKIT_API_KEY: process.env.THEOKIT_API_KEY } : {}),
    ...(process.env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY } : {}),
    THEOCLAW_OWNERS: 'telegram:owner',
    THEOCLAW_DM_POLICY: 'allowlist',
    THEOCLAW_PORT: '0',
    THEOCLAW_CONTROL_TOKEN: token,
    ...(lan ? { THEOCLAW_HOST: lanAddress(), THEOCLAW_PUBLIC_BIND: 'yes' } : {}),
  }
  const signals = new EventEmitter()
  let onExit: (code: number) => void = () => undefined
  const exited = new Promise<number>((resolve) => (onExit = resolve))
  const called = performance.now()
  const running = await startTheoClaw({
    env,
    agentFactory: createAgentFactory(env),
    builders: () => [],
    stdout: () => undefined,
    stderr: () => undefined,
    // No stream to mask: the worker's own streams must not stay wrapped after the test.
    streams: [],
    signals,
    exit: (code) => onExit(code),
  })
  const started: Started = { running, token, called, resolved: performance.now(), signals, exited, stopped: false }
  cleanups.push(async () => {
    if (!started.stopped) await stop(started)
  })
  return started
}

function instanceName(running: RunningTheoClaw): string {
  return `${serviceName(hostname(), running.address().port)}._theoclaw._tcp.local`
}

/** One chat frame over `/control`: resolves with the non-empty text deltas once the `done` frame arrives. */
async function controlTurn(started: Started): Promise<string[]> {
  const { host, port } = started.running.address()
  const socket = new WebSocket(`ws://${host}:${port}/control`, {
    headers: { Authorization: `Bearer ${started.token}` },
  })
  try {
    const frames: Array<Record<string, unknown>> = []
    const done = new Promise<void>((resolve, reject) => {
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as Record<string, unknown>
        frames.push(frame)
        if (frame.type === 'done') resolve()
        if (frame.type === 'error') reject(new Error(`the turn failed: ${JSON.stringify(frame)}`))
      })
      socket.once('error', reject)
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('unexpected-response', () => reject(new Error('the /control upgrade was refused')))
    })
    socket.send(JSON.stringify({ type: 'chat', message: 'Reply with the single word: pong' }))
    await withinMs(done, 60_000, 'the done frame')
    return frames
      .filter((frame) => frame.type === 'event')
      .map((frame) => frame.event as { type: string; content?: unknown })
      .filter((event) => event.type === 'text_delta' && typeof event.content === 'string' && event.content.trim() !== '')
      .map((event) => String(event.content))
  } finally {
    socket.close()
  }
}

describe.skipIf(!LIVE)('LAN discovery on a real multicast socket', () => {
  it(
    'a real-model turn on a LAN-bound instance that answers an mDNS query with its port',
    { timeout: 120_000 },
    async () => {
      const socket = await openSocket()
      const started = await start(true)
      const name = instanceName(started.running)
      const port = started.running.address().port

      // EC-7: a record received before the start resolved satisfies NFR-001 too.
      const first = await waitForSrv(socket, name, {
        after: started.called,
        withinMs: FIRST_ANNOUNCEMENT_MS + (started.resolved - started.called),
      })
      expect(first.at - started.resolved).toBeLessThanOrEqual(FIRST_ANNOUNCEMENT_MS)
      expect(first.port).toBe(port)

      for (let query = 0; query < 3; query += 1) {
        const sent = querySrv(socket, name)
        const answer = await waitForSrv(socket, name, { after: sent, withinMs: ANSWER_MS })
        expect(answer.port).toBe(started.running.address().port)
        // The gap between queries is the plan's cadence (NFR-001), not a wait for a condition.
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, sent + QUERY_GAP_MS - performance.now())))
      }

      // EC-3: the turn runs after the announcement, so its seconds cannot hide the first record.
      const texts = await controlTurn(started)
      expect(texts.length).toBeGreaterThan(0)
    },
  )

  it('a loopback-bound instance answers no mDNS query', { timeout: 60_000 }, async () => {
    const socket = await openSocket()
    const control = await startControlResponder()
    cleanups.push(() => control.close())
    const started = await start(false)

    const { answers } = await expectNoSrv(socket, instanceName(started.running), { windowMs: SILENCE_MS, control })

    expect(answers).toHaveLength(0)
  })

  it('stops answering once TheoClaw stops', { timeout: 60_000 }, async () => {
    const socket = await openSocket()
    const control = await startControlResponder()
    cleanups.push(() => control.close())
    const started = await start(true)
    const name = instanceName(started.running)
    await waitForSrv(socket, name, {
      after: started.called,
      withinMs: FIRST_ANNOUNCEMENT_MS + (started.resolved - started.called),
    })

    await stop(started)
    const { answers } = await expectNoSrv(socket, name, { windowMs: SILENCE_MS, control })

    expect(answers).toHaveLength(0)
  })
})
