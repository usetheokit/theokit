import type { EventEmitter } from 'node:events'
import type * as Http from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CLIENT_BASE = 50_000
const own = (attempt: number): number => 4_999_000 + attempt

const h = vi.hoisted(() => ({
  children: [] as { pid: number; port: number; exited: boolean; emitter: unknown }[],
  /** Pids listening on a port for the n-th spawned child (1-based). */
  listeners: (_port: number, _attempt: number): number[] => [],
  parents: {} as Record<number, number>,
  toolFails: false,
  /** Descriptor number the listener of the n-th child holds (lsof only). */
  fd: (_attempt: number) => 7 as number,
  /** Pid holding the connection that answered the n-th readiness request; undefined: not visible. */
  connOwner: (_attempt: number, _call: number): number | undefined => 0,
  calls: 0,
  killed: [] as string[][],
  lsofFailure: undefined as { status: number; stderr: string } | undefined,
  /** HTTP status of the readiness probe, or undefined for a listener that does not speak HTTP. */
  status: (_port: number, _attempt: number): number | undefined => 200,
}))

vi.mock('node:child_process', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  return {
    spawn: (_cmd: string, args: string[]) => {
      const emitter = new Emitter() as InstanceType<typeof Emitter> & Record<string, unknown>
      const pid = 4_999_000 + h.children.length + 1
      const rec = { pid, port: Number(args[args.indexOf('--port') + 1]), exited: false, emitter }
      h.children.push(rec)
      emitter.pid = pid
      emitter.stdout = new Emitter()
      emitter.stderr = new Emitter()
      emitter.kill = () => {
        rec.exited = true
        emitter.emit('exit', null, 'SIGTERM')
      }
      return emitter
    },
    execFileSync: (cmd: string, args: string[]) => {
      if (cmd === 'taskkill') {
        h.killed.push(args)
        const rec = h.children.find((c) => String(c.pid) === args[1])
        if (rec !== undefined && !rec.exited) {
          rec.exited = true
          ;(rec.emitter as EventEmitter).emit('exit', null, 'SIGKILL')
        }
        return ''
      }
      if (h.lsofFailure !== undefined && cmd === 'lsof') {
        throw Object.assign(new Error('lsof failed'), h.lsofFailure)
      }
      if (h.toolFails) throw new Error(`${cmd} not found`)
      const last = h.children.length
      const port = h.children[last - 1]?.port ?? 0
      const pids = h.listeners(port, last)
      const client = CLIENT_BASE + last
      if (cmd === 'lsof' && !args.includes('-sTCP:LISTEN')) {
        const owner = h.connOwner(last, h.calls)
        return owner === undefined
          ? ''
          : `p${String(owner || own(last))}\nn127.0.0.1:${String(port)}->127.0.0.1:${String(client)}\n`
      }
      if (cmd === 'netstat' && h.connOwner(last, h.calls) !== undefined) {
        const found = h.connOwner(last, h.calls)
        const owner = found === 0 ? own(last) : found
        return `  TCP    127.0.0.1:${String(client)}    127.0.0.1:${String(port)}    ESTABLISHED    1\n  TCP    127.0.0.1:${String(port)}    127.0.0.1:${String(client)}    ESTABLISHED    ${String(owner)}\n${pids
          .map((p) => `  TCP    0.0.0.0:${String(port)}    0.0.0.0:0    LISTENING    ${String(p)}`)
          .join('\n')}`
      }
      if (cmd === 'lsof') {
        return pids.map((p) => `p${String(p)}\nf${String(h.fd(last))}\n`).join('')
      }
      if (cmd === 'netstat') {
        return pids
          .map((p) => `  TCP    0.0.0.0:${String(port)}    0.0.0.0:0    LISTENING    ${String(p)}`)
          .join('\n')
      }
      const pid = Number(/ProcessId=(\d+)/.exec(args.join(' '))?.[1] ?? args.at(-1))
      return String(h.parents[pid] ?? 1)
    },
  }
})

vi.mock('node:http', async (orig: () => Promise<typeof Http>) => {
  const { EventEmitter: Emitter } = await import('node:events')
  const real = await orig()
  return {
    ...real,
    get: (opts: { port: number }, cb: (res: unknown) => void) => {
      const req = new Emitter() as InstanceType<typeof Emitter> & Record<string, unknown>
      req.destroy = () => undefined
      setImmediate(() => {
        h.calls++
        const status = h.status(opts.port, h.children.length)
        if (status === undefined) {
          req.emit('error', new Error('not http'))
          return
        }
        const res = new Emitter() as InstanceType<typeof Emitter> & Record<string, unknown>
        res.statusCode = status
        res.socket = { localPort: CLIENT_BASE + h.children.length }
        res.resume = () => setImmediate(() => res.emit('end'))
        cb(res)
      })
      return req
    },
  }
})

import {
  connectionOwnership,
  portOwnership,
  socketsHeldBy,
  startTestServer,
  TestServerBootError,
  type RunCommand,
} from '../../packages/theo/src/testing/start-test-server.js'

const CHILD = 100
const PORT = 4000

/** Fake process table: pid -> ppid. */
function fake(opts: { listeners: number[]; parents: Record<number, number>; fail?: boolean }) {
  const run: RunCommand = (cmd, args) => {
    if (opts.fail) throw new Error(`${cmd} not found`)
    if (cmd === 'lsof') {
      return opts.listeners.map((p) => `p${String(p)}\n`).join('')
    }
    if (cmd === 'netstat') {
      return opts.listeners
        .map((p) => `  TCP    0.0.0.0:${String(PORT)}    0.0.0.0:0    LISTENING    ${String(p)}`)
        .join('\n')
    }
    const pid = Number(/ProcessId=(\d+)/.exec(args.join(' '))?.[1] ?? args.at(-1))
    return String(opts.parents[pid] ?? 1)
  }
  return run
}

describe.each(['darwin', 'win32'] as const)('port ownership on %s', (platform) => {
  it('accepts the child and its descendants', () => {
    const run = fake({ listeners: [102], parents: { 102: 101, 101: CHILD } })
    expect(portOwnership(PORT, CHILD, { platform, run })).toMatchObject({ owner: 'own' })
  })

  it('detects a substituted foreign listener', () => {
    const run = fake({ listeners: [555], parents: { 555: 1 } })
    expect(portOwnership(PORT, CHILD, { platform, run })).toMatchObject({ owner: 'foreign' })
  })

  it('reports none for a port nobody listens on', () => {
    const run = fake({ listeners: [], parents: {} })
    expect(portOwnership(PORT, CHILD, { platform, run })).toMatchObject({ owner: 'none' })
  })

  it('is foreign when a foreign listener shares the port with the child (IPv4 vs IPv6)', () => {
    const run = fake({ listeners: [101, 555], parents: { 101: CHILD, 555: 1 } })
    expect(portOwnership(PORT, CHILD, { platform, run })).toMatchObject({ owner: 'foreign' })
  })

  it('reports unknown, with the cause, when the probe tool fails', () => {
    const run = fake({ listeners: [], parents: {}, fail: true })
    const res = portOwnership(PORT, CHILD, { platform, run })
    expect(res.owner).toBe('unknown')
    expect(res).toMatchObject({ reason: expect.stringContaining('not found') })
  })
})

describe.each(['darwin', 'win32'] as const)('startTestServer substitution on %s', (platform) => {
  const realPlatform = process.platform
  let app: string

  beforeEach(() => {
    app = mkdtempSync(join(tmpdir(), 'start-test-server-'))
    mkdirSync(join(app, 'node_modules', 'theokit'), { recursive: true })
    writeFileSync(join(app, 'package.json'), '{}')
    writeFileSync(join(app, 'node_modules', 'theokit', 'package.json'), '{"bin":"bin.js"}')
    h.children.length = 0
    h.toolFails = false
    h.parents = {}
    h.status = () => 200
    Object.defineProperty(process, 'platform', { value: platform })
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
      const rec = h.children.find((c) => c.pid === Math.abs(pid))
      if (rec === undefined || rec.exited) {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      }
      if (signal !== 0) {
        rec.exited = true
        ;(rec.emitter as EventEmitter).emit('exit', null, signal)
      }
      return true
    }) as typeof process.kill)
    h.calls = 0
    h.connOwner = () => 0
    h.lsofFailure = undefined
    h.killed = []
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform })
    vi.restoreAllMocks()
    rmSync(app, { recursive: true, force: true })
  })

  it('accepts a server the child owns', async () => {
    h.listeners = (_port, attempt) => [own(attempt)]
    h.status = () => 200
    const server = await startTestServer({ cwd: app, timeoutMs: 5000 })
    expect(h.children).toHaveLength(1)
    await server.close()
  })

  it.each([404, undefined])(
    'retries on a foreign listener that answers %s, then fails with a clear error',
    async (status) => {
      h.listeners = () => [555]
      h.status = () => status
      const err = await startTestServer({ cwd: app, timeoutMs: 20_000 }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(TestServerBootError)
      expect((err as Error).message).toContain('taken by another process')
      expect(h.children).toHaveLength(3)
      expect(h.children.every((c) => c.exited)).toBe(true)
    },
    30_000,
  )

  it('boots on a new port after one substitution', async () => {
    h.listeners = (_port, attempt) => (attempt === 1 ? [555] : [own(attempt)])
    const server = await startTestServer({ cwd: app, timeoutMs: 20_000 })
    expect(h.children).toHaveLength(2)
    expect(h.children[0]?.exited).toBe(true)
    expect(h.children[0]?.port).not.toBe(h.children[1]?.port)
    await server.close()
  }, 30_000)

  it('rejects a foreign server that takes the port while the readiness request is in flight', async () => {
    h.listeners = (_port, attempt) => (swapped ? [555] : [own(attempt)])
    let swapped = false
    h.connOwner = () => (swapped ? 555 : 0)
    h.status = () => {
      swapped = true // the child's listener goes away and a foreign one answers 200
      return 200
    }
    const err = await startTestServer({ cwd: app, timeoutMs: 20_000 }).catch((e: unknown) => e)
    expect((err as Error).message).toContain('taken by another process')
    expect(h.children.every((c) => c.exited)).toBe(true)
  }, 30_000)

  it('does not accept a 200 whose connection was held by another process', async () => {
    // The child released the port, a foreign server answered, the child bound it again: both
    // listener snapshots name the child, only the connection that answered tells the truth.
    h.listeners = (_port, attempt) => [own(attempt)]
    h.connOwner = (attempt) => (attempt === 1 ? 555 : 0)
    const server = await startTestServer({ cwd: app, timeoutMs: 20_000 })
    expect(h.children).toHaveLength(2)
    expect(h.children[0]?.exited).toBe(true)
    await server.close()
  }, 30_000)

  it('does not accept a 200 whose connection cannot be seen', async () => {
    h.listeners = (_port, attempt) => [own(attempt)]
    h.connOwner = (_attempt, call) => (call === 1 ? undefined : 0)
    const server = await startTestServer({ cwd: app, timeoutMs: 20_000 })
    expect(h.calls).toBe(2)
    expect(h.children).toHaveLength(1)
    await server.close()
  }, 30_000)

  it('ends the whole process tree on close', async () => {
    h.listeners = (_port, attempt) => [own(attempt)]
    const server = await startTestServer({ cwd: app, timeoutMs: 5000 })
    await server.close()
    if (platform === 'win32') {
      expect(h.killed).toEqual([['/pid', String(h.children[0]?.pid), '/T', '/F']])
    } else {
      expect(h.killed).toEqual([])
    }
    expect(h.children[0]?.exited).toBe(true)
  })

  it('reports an lsof failure with status 1, not a readiness timeout', async () => {
    if (platform === 'win32') return
    h.listeners = (_port, attempt) => [own(attempt)]
    h.lsofFailure = { status: 1, stderr: 'lsof: permission denied' }
    const err = await startTestServer({ cwd: app, timeoutMs: 20_000 }).catch((e: unknown) => e)
    expect((err as Error).message).toContain('permission denied')
    expect((err as Error).message).not.toContain('not ready within')
    expect(h.children).toHaveLength(1)
  }, 30_000)

  it('rejects a foreign listener that shares the port with the child', async () => {
    h.listeners = (_port, attempt) => [own(attempt), 555]
    const err = await startTestServer({ cwd: app, timeoutMs: 20_000 }).catch((e: unknown) => e)
    expect((err as Error).message).toContain('taken by another process')
  }, 30_000)

  it('fails without retrying, naming the cause, when ownership cannot be established', async () => {
    h.toolFails = true
    const err = await startTestServer({ cwd: app, timeoutMs: 20_000 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TestServerBootError)
    expect((err as Error).message).toContain('not found')
    expect(h.children).toHaveLength(1)
    expect(h.children[0]?.exited).toBe(true)
  })
})

describe('socketsHeldBy', () => {
  const fs = (readlink: (p: string) => string) => ({
    readFileSync: () => '1 (node) S 1 77 77 0',
    readdirSync: () => ['3', '4', '5'],
    readlinkSync: readlink,
  })

  it('keeps the listening socket when another descriptor vanishes during the scan', () => {
    const held = socketsHeldBy(
      '10',
      77,
      new Set(['999']),
      fs((p) => {
        if (p.endsWith('/4')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return p.endsWith('/5') ? 'socket:[999]' : 'pipe:[1]'
      }),
    )
    expect(held).toEqual(['999'])
  })

  it('ignores a process of another group', () => {
    expect(
      socketsHeldBy(
        '10',
        78,
        new Set(['999']),
        fs(() => 'socket:[999]'),
      ),
    ).toEqual([])
  })
})

describe('lsof exit status 1', () => {
  const failing =
    (e: object): RunCommand =>
    () => {
      throw Object.assign(new Error('Command failed'), e)
    }
  it('is "nobody" when it printed nothing', () => {
    const run = failing({ status: 1, stderr: '', stdout: '' })
    expect(portOwnership(PORT, CHILD, { platform: 'darwin', run })).toMatchObject({ owner: 'none' })
  })
  it('is unknown, with the message, when it printed an error', () => {
    const run = failing({ status: 1, stderr: 'lsof: WARNING: boom', stdout: '' })
    const res = portOwnership(PORT, CHILD, { platform: 'darwin', run })
    expect(res).toMatchObject({ owner: 'unknown', reason: expect.stringContaining('boom') })
    expect(connectionOwnership(PORT, 5555, CHILD, { platform: 'darwin', run }).owner).toBe(
      'unknown',
    )
  })
})
