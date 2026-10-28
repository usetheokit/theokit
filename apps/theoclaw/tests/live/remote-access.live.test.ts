import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { request } from 'node:http'
import { connect, createServer, type Server } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'

import { type RunningTheoClaw, startTheoClaw } from '../../src/composition.js'
import { createAgentFactory } from '../../src/control-plane/agent-factory.js'
import { useForwardCleanup } from './support/forward-cleanup.js'
import { findBinary, openSshForward, type SshForward, waitForForward } from './support/ssh-forward.js'

/**
 * OC-24 (B-512): the owner reaches the loopback control plane from another machine through an SSH
 * local forward. Every test here runs a real `sshd` the harness starts from a temp directory, never
 * the host's, and a real `ssh -N -L` client with only the run's own configuration. Runs only with
 * THEOCLAW_LIVE=1; once enabled, a missing binary fails by name and never skips.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'

const scratch: string[] = []

/** The bounds of the reconnect budget (plan Drawbacks row 3): 3000 + 2 x 10000 + 2 x 2000 + 2 x 12000 + 2500 ms. */
const START_MS = 3_000
const STOP_MS = 3_000
const UPGRADE_MS = 2_000
const TURN_MS = 12_000

/** Every token any test generated, and every chunk any process wrote, by stream (the token guard). */
const tokensIssued: string[] = []
const outputLog = new Map<string, string[]>()
const stops: Array<() => Promise<void>> = []
let starts = 0

function append(key: string, chunk: string): void {
  const chunks = outputLog.get(key) ?? []
  chunks.push(chunk)
  outputLog.set(key, chunks)
}

/** Each stream's chunks joined in order: a token split across two chunks of one stream is still found. */
function joinedStreams(log: ReadonlyMap<string, readonly string[]>): Array<{ readonly key: string; readonly text: string }> {
  return [...log].map(([key, chunks]) => ({ key, text: chunks.join('') }))
}

function leakedTokens(): string[] {
  const streams = joinedStreams(outputLog)
  return tokensIssued.filter((token) => streams.some((stream) => stream.text.includes(token)))
}

/** Rejects naming `what` once `ms` pass, through an abort signal rather than a timer callback. */
function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  const over = new Promise<never>((_, reject) =>
    AbortSignal.timeout(ms).addEventListener('abort', () => reject(new Error(`${what} did not finish within ${ms} ms`)), { once: true }),
  )
  return Promise.race([work, over])
}

interface Claw {
  readonly running: RunningTheoClaw
  readonly token: string | undefined
  agentBuilds(): number
}

/** TheoClaw on 127.0.0.1:0 through B-372's `startTheoClaw`, its output in `outputLog`, its agents counted. */
async function startClaw(withToken: boolean): Promise<Claw> {
  const model = process.env.THEOCLAW_MODEL
  const modelKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY
  if (!model || !modelKey) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY')
  const token = withToken ? randomBytes(24).toString('hex') : undefined
  if (token !== undefined) tokensIssued.push(token)
  const env: Record<string, string | undefined> = {
    THEOCLAW_MODEL: model,
    ...(process.env.THEOKIT_API_KEY ? { THEOKIT_API_KEY: process.env.THEOKIT_API_KEY } : {}),
    ...(process.env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY } : {}),
    THEOCLAW_OWNERS: 'telegram:owner',
    THEOCLAW_DM_POLICY: 'allowlist',
    THEOCLAW_PORT: '0',
    THEOCLAW_MDNS: 'off',
    ...(token === undefined ? {} : { THEOCLAW_CONTROL_TOKEN: token }),
  }
  const index = starts++
  const agent = createAgentFactory(env)
  let builds = 0
  const signals = new EventEmitter()
  let onExit: (code: number) => void = () => undefined
  const exited = new Promise<number>((resolve) => (onExit = resolve))
  const starting = startTheoClaw({
      env,
      agentFactory: () => ((builds += 1), agent()),
      builders: () => [],
      stdout: (line) => append(`theoclaw:${index}:stdout`, `${line}\n`),
      stderr: (line) => append(`theoclaw:${index}:stderr`, `${line}\n`),
      // No stream to mask: the worker's own streams must not stay wrapped after the test.
      streams: [],
      signals,
      exit: (code) => onExit(code),
    })
  let running: RunningTheoClaw
  try {
    running = await within(starting, START_MS, 'the TheoClaw start')
  } catch (error) {
    // A start that resolves after its bound must not stay listening for the rest of the file.
    void starting.then(() => signals.emit('SIGTERM'), () => undefined)
    throw error
  }
  stops.push(async () => {
    signals.emit('SIGTERM')
    expect(await within(exited, STOP_MS, 'the TheoClaw stop')).toBe(0)
  })
  return { running, token, agentBuilds: () => builds }
}

function forwardTo(claw: Claw): Promise<SshForward> {
  return openSshForward({
    targetPort: claw.running.address().port,
    onOutput: (origin, chunk) => append(`${origin.source}:${origin.pid}:${origin.stream}`, chunk),
  })
}

/** The status a raw `/control` upgrade through the forward gets: 101, or the refusal's 401/404. */
function upgradeStatus(port: number, token: string | undefined): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path: '/control',
      signal: AbortSignal.timeout(UPGRADE_MS),
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
    })
    req.once('response', (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    req.once('upgrade', (response, socket) => {
      socket.destroy()
      resolve(response.statusCode ?? 0)
    })
    req.once('error', reject)
    req.end()
  })
}

type Frame = Record<string, unknown>

/** One chat turn over `/control` through the forward; resolves with every frame once `done` arrives. */
async function turnThrough(port: number, token: string): Promise<Frame[]> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/control`, {
    headers: { Authorization: `Bearer ${token}` },
    handshakeTimeout: UPGRADE_MS,
  })
  const frames: Frame[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    const signal = AbortSignal.timeout(TURN_MS)
    const done = new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () =>
        reject(new Error(`no done frame within ${TURN_MS} ms; last frame: ${JSON.stringify(frames.at(-1) ?? null)}`)),
      )
      socket.on('message', (raw) => {
        let frame: Frame
        try {
          frame = JSON.parse(String(raw)) as Frame
        } catch {
          return reject(new Error(`a frame that is not JSON: ${String(raw).slice(0, 200)}`))
        }
        frames.push(frame)
        if (frame.type === 'done') resolve()
        if (frame.type === 'error') reject(new Error(`the turn failed: ${JSON.stringify(frame)}`))
      })
    })
    socket.send(JSON.stringify({ type: 'chat', message: 'Reply with the word pong.' }))
    await done
    return frames
  } finally {
    socket.close()
  }
}

/**
 * Try a chat turn with `token` through the forward: an upgrade that opens gets a chat frame and is
 * held until its final frame, so an accepted upgrade builds an agent and a refused one cannot.
 */
async function attemptChat(port: number, token: string | undefined): Promise<void> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/control`, {
    headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
    handshakeTimeout: UPGRADE_MS,
  })
  const signal = AbortSignal.timeout(TURN_MS)
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
    socket.once('unexpected-response', () => resolve())
    socket.once('error', () => resolve())
    socket.once('open', () => socket.send(JSON.stringify({ type: 'chat', message: 'Reply with the word pong.' })))
    socket.on('message', (raw) => {
      if (/"type":"(done|error)"/.test(String(raw))) resolve()
    })
  })
  socket.terminate()
}

function isNonEmptyText(frame: Frame): boolean {
  const event = frame.event as { type?: unknown; content?: unknown } | undefined
  return frame.type === 'event' && event?.type === 'text_delta' && typeof event.content === 'string' && event.content.trim() !== ''
}

function connectErrorCode(port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => (socket.destroy(), resolve('connected')))
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message))
  })
}

/** Every path under `~/.ssh`, with each regular file's mtime and SHA-256; `absent` when there is none (EC-3). */
function snapshotSshDir(): Record<string, string> | 'absent' {
  const dir = join(homedir(), '.ssh')
  if (!existsSync(dir)) return 'absent'
  const snapshot: Record<string, string> = {}
  for (const path of readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()) {
    const full = join(dir, path)
    const stat = lstatSync(full)
    if (!stat.isFile()) {
      snapshot[path] = stat.isDirectory() ? 'dir' : 'other'
      continue
    }
    // One descriptor for both the mtime and the bytes, so the file cannot change between them.
    const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const opened = fstatSync(fd)
      snapshot[path] = `${opened.mtimeMs} ${createHash('sha256').update(readFileSync(fd)).digest('hex')}`
    } finally {
      closeSync(fd)
    }
  }
  return snapshot
}

/** A directory holding links to the named binaries only, so the harness searches nothing else. */
function binDirWith(names: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-bin-'))
  scratch.push(dir)
  for (const name of names) symlinkSync(findBinary(name), join(dir, name))
  return dir
}

/** A port nothing listens on: bound on port 0, read, released. */
async function releasedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no TCP address for the probe server')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

/** A throwaway server that writes back what it reads, standing in for TheoClaw in the harness tests. */
async function echoServer(): Promise<{ readonly port: number; readonly server: Server }> {
  const server = createServer((socket) => socket.pipe(socket))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no TCP address for the echo server')
  return { port: address.port, server }
}

describe.skipIf(!LIVE)('remote access over an SSH local forward', () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
  useForwardCleanup()

  let sshSnapshotBefore: ReturnType<typeof snapshotSshDir> = 'absent'
  beforeAll(() => {
    sshSnapshotBefore = snapshotSshDir()
  }, 60_000)

  afterEach(async () => {
    for (const stop of stops.splice(0).reverse()) await stop()
  }, 60_000)

  afterAll(async () => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
    for (const stop of stops.splice(0)) await stop()
    // Repeated over the complete log, after every teardown wrote what it writes on the way down.
    expect(leakedTokens()).toEqual([])
  }, 60_000)

  it('fails naming the binary when ssh cannot be found', async () => {
    const binDir = binDirWith(['sshd', 'ssh-keygen'])
    await expect(openSshForward({ targetPort: 1, binDir })).rejects.toThrow(/binary not found: ssh /)
  })

  it('fails naming the binary when sshd cannot be found', async () => {
    const binDir = binDirWith(['ssh', 'ssh-keygen'])
    await expect(openSshForward({ targetPort: 1, binDir })).rejects.toThrow(/binary not found: sshd /)
  })

  it('fails naming the binary when ssh-keygen cannot be found', async () => {
    const binDir = binDirWith(['sshd', 'ssh'])
    await expect(openSshForward({ targetPort: 1, binDir })).rejects.toThrow(/binary not found: ssh-keygen /)
  })

  it('fails naming the port after the 10000 ms deadline when the forward never opens', async () => {
    const freePort = await releasedPort()
    const t0 = Date.now()
    await expect(waitForForward(freePort)).rejects.toThrow(new RegExp(String(freePort)))
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(9000)
    expect(elapsed).toBeLessThanOrEqual(11000)
  })

  it("spawns sshd and ssh with the run's own configuration only", async () => {
    const echo = await echoServer()
    try {
      const forward = await openSshForward({ targetPort: echo.port })
      const a = forward.spawnedArgs()
      expect(a.ssh).toEqual(
        expect.arrayContaining(['-F', '/dev/null', 'IdentitiesOnly=yes', 'StrictHostKeyChecking=yes', 'GlobalKnownHostsFile=/dev/null']),
      )
      expect(a.ssh).toContain(`UserKnownHostsFile=${join(forward.tempDir, 'known_hosts')}`)
      expect(a.sshd[a.sshd.indexOf('-f') + 1]?.startsWith(forward.tempDir)).toBe(true)
      expect(forward.sshdPort).not.toBe(22)
      await forward.close()
    } finally {
      await new Promise<void>((resolve) => echo.server.close(() => resolve()))
    }
  })
  it('refuses an upgrade with no token through an SSH local forward', async () => {
    const claw = await startClaw(true)
    const forward = await forwardTo(claw)
    const buildsBefore = claw.agentBuilds()
    const status = await upgradeStatus(forward.localPort, undefined)
    expect(status).toBe(401)
    await attemptChat(forward.localPort, undefined)
    const built = claw.agentBuilds() - buildsBefore
    expect(built).toBe(0)
  })

  it('refuses an upgrade with a wrong token through an SSH local forward', async () => {
    const claw = await startClaw(true)
    const forward = await forwardTo(claw)
    const buildsBefore = claw.agentBuilds()
    const status = await upgradeStatus(forward.localPort, 'wrong-token')
    expect(status).toBe(401)
    await attemptChat(forward.localPort, 'wrong-token')
    const built = claw.agentBuilds() - buildsBefore
    expect(built).toBe(0)
  })

  it('answers 404 through the forward when the control token is unset', async () => {
    const claw = await startClaw(false)
    const forward = await forwardTo(claw)
    const token = randomBytes(24).toString('hex')
    tokensIssued.push(token)
    const status = await upgradeStatus(forward.localPort, token)
    expect(status).toBe(404)
  })

  it('a real-model turn over the control socket through an SSH local forward', async () => {
    const claw = await startClaw(true)
    const forward = await forwardTo(claw)
    const status = await upgradeStatus(forward.localPort, claw.token)
    expect(status).toBe(101)
    const frames = await turnThrough(forward.localPort, claw.token!)
    const last = frames.at(-1)
    expect(last).toEqual({ type: 'done' })
    const texts = frames.filter(isNonEmptyText)
    expect(texts.length, `frames: ${JSON.stringify(frames)}`).toBeGreaterThan(0)
    // The counter the refusal tests read does count: an accepted turn built its agent.
    expect(claw.agentBuilds()).toBeGreaterThanOrEqual(1)
  })

  it('accepts the owner again after the forward is closed and reopened', async () => {
    const claw = await startClaw(true)
    const first = await forwardTo(claw)
    expect((await turnThrough(first.localPort, claw.token!)).at(-1)).toEqual({ type: 'done' })
    await first.close()
    const second = await forwardTo(claw)
    const frames = await turnThrough(second.localPort, claw.token!)
    const last = frames.at(-1)
    expect(last).toEqual({ type: 'done' })
  })

  it('the turn crossed the test sshd and stops when it stops', async () => {
    const claw = await startClaw(true)
    const forward = await forwardTo(claw)
    expect((await turnThrough(forward.localPort, claw.token!)).at(-1)).toEqual({ type: 'done' })
    const log = forward.sshdLog()
    expect(log).toMatch(/Accepted publickey for \S+/)
    await forward.close()
    const code = await connectErrorCode(forward.localPort)
    expect(code).toBe('ECONNREFUSED')
  })

  it('never prints the control token in any process output', () => {
    const streams = joinedStreams(outputLog)
    const ours = streams.filter((s) => s.key.startsWith('theoclaw:')).map((s) => s.text).join('')
    expect(ours.length).toBeGreaterThan(0)
    const sshd = streams.filter((s) => s.key.startsWith('sshd:')).map((s) => s.text).join('')
    expect(sshd.length).toBeGreaterThan(0)
    const leaks = tokensIssued.filter((t) => streams.some((s) => s.text.includes(t)))
    expect(leaks).toEqual([])
  })

  it('leaves ~/.ssh untouched', () => {
    const after = snapshotSshDir()
    expect(after).toEqual(sshSnapshotBefore)
  })
})
