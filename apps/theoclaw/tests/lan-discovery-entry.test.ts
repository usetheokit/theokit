import { EventEmitter } from 'node:events'
import net from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { type RunningTheoClaw, startTheoClaw } from '../src/composition.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { type ControlPlaneHandle, listenControlPlane } from '../src/control-plane/listener.js'
import type { PublishedService, PublisherFactory } from '../src/discovery/publisher.js'

const EXIT_DEADLINE_MS = 5000

/** A LAN bind every runner can open: `0.0.0.0` is not loopback, and the publisher is a fake (EC-4). */
function lanEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    THEOCLAW_MODEL: 'openrouter/some/model',
    OPENROUTER_API_KEY: 'model-key-value-5d1e8c',
    THEOCLAW_OWNERS: 'telegram:owner',
    THEOCLAW_DM_POLICY: 'allowlist',
    THEOCLAW_PORT: '0',
    THEOCLAW_HOST: '0.0.0.0',
    THEOCLAW_PUBLIC_BIND: 'yes',
    ...extra,
  }
}

const opened: ControlPlaneHandle[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const handle of opened.splice(0)) if (handle.server.listening) await handle.close()
})

/**
 * `startTheoClaw` with a fake publisher factory and stand-ins for everything the process owns. Every
 * publisher call, the listener's close and the exit are recorded in one log, so their order is read
 * from one place.
 */
function harness(options: { holdListen?: Promise<void>; failListen?: Error } = {}) {
  const log: string[] = []
  const published: PublishedService[] = []
  const stderr: string[] = []
  const signals = new EventEmitter()
  let factoryCalls = 0
  let builderCalls = 0
  let onExit: (code: number) => void = () => undefined
  const exited = new Promise<number>((resolve) => (onExit = resolve))
  const createPublisher: PublisherFactory = () => {
    factoryCalls += 1
    return {
      publish: (service) => {
        log.push('publish')
        published.push(service)
      },
      unpublishAll: () => (log.push('unpublishAll'), Promise.resolve()),
      destroy: () => (log.push('destroy'), Promise.resolve()),
    }
  }
  const start = (env: Record<string, string | undefined>): Promise<RunningTheoClaw> =>
    startTheoClaw({
      env,
      agentFactory: () => ({ send: () => Promise.reject(new Error('no turn in these tests')) }),
      builders: () => {
        builderCalls += 1
        return []
      },
      stdout: () => undefined,
      stderr: (line) => void stderr.push(line),
      streams: [],
      signals,
      exit: (code) => {
        log.push('exit')
        onExit(code)
      },
      createPublisher,
      listen: async (listenOptions) => {
        await options.holdListen
        if (options.failListen !== undefined) throw options.failListen
        const handle = await listenControlPlane(listenOptions)
        opened.push(handle)
        return {
          ...handle,
          close: () => (log.push('close'), handle.close()),
        }
      },
    })
  const exitedWithin = async (): Promise<number> => {
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`exit was not called within ${EXIT_DEADLINE_MS} ms`)), EXIT_DEADLINE_MS)
    })
    try {
      return await Promise.race([exited, deadline])
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    start,
    signals,
    log,
    published,
    stderr,
    exitedWithin,
    get factoryCalls() {
      return factoryCalls
    },
    get builderCalls() {
      return builderCalls
    },
  }
}

/** FR-001, FR-004, FR-005 (B-513): the start parses, announces and withdraws in the right order. */
describe('startTheoClaw and LAN discovery', () => {
  it('THEOCLAW_MDNS=off starts TheoClaw with no publisher', async () => {
    const run = harness()

    await run.start(lanEnv({ THEOCLAW_MDNS: 'off' }))

    expect(run.factoryCalls).toBe(0)
    expect(run.stderr.filter((line) => line === 'LAN discovery is off: THEOCLAW_MDNS=off')).toHaveLength(1)
  })

  it('THEOCLAW_MDNS=false stops the start before any socket or runner', async () => {
    const listens = vi.spyOn(net.Server.prototype, 'listen')
    const run = harness()

    const start = run.start(lanEnv({ THEOCLAW_MDNS: 'false' }))

    await expect(start).rejects.toBeInstanceOf(TheoClawConfigError)
    await expect(start).rejects.toThrow(/THEOCLAW_MDNS/)
    await expect(start).rejects.toThrow(/on or off/)
    expect(listens).not.toHaveBeenCalled()
    expect(run.builderCalls).toBe(0)
    expect(run.factoryCalls).toBe(0)
  })

  it('a LAN-bound start publishes once with the port the handle reports', async () => {
    const run = harness()

    const running = await run.start(lanEnv())

    expect(run.factoryCalls).toBe(1)
    expect(run.published).toHaveLength(1)
    expect(run.published[0]?.port).toBe(running.address().port)
  })

  it('a signal while the listener opens publishes nothing and still closes the listener', async () => {
    let release = (): void => undefined
    const holdListen = new Promise<void>((resolve) => (release = resolve))
    const run = harness({ holdListen })

    const starting = run.start(lanEnv())
    run.signals.emit('SIGTERM')
    release()
    await starting

    expect(await run.exitedWithin()).toBe(0)
    if (run.factoryCalls > 0) expect(run.log).toContain('destroy')
    expect(run.log).toContain('close')
    expect(run.log.at(-1)).toBe('exit')
  })

  it('shutdown withdraws the service before the listener closes', async () => {
    const run = harness()
    await run.start(lanEnv())

    run.signals.emit('SIGTERM')

    expect(await run.exitedWithin()).toBe(0)
    expect(run.log).toEqual(['publish', 'unpublishAll', 'destroy', 'close', 'exit'])
  })

  it('closing the running instance withdraws the service before the listener closes', async () => {
    const run = harness()
    const running = await run.start(lanEnv())

    await running.close()

    expect(run.log).toEqual(['publish', 'unpublishAll', 'destroy', 'close'])
  })

  it('a start whose listener fails creates no publisher', async () => {
    const run = harness({ failListen: Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }) })

    await expect(run.start(lanEnv())).rejects.toThrow('EADDRINUSE')

    expect(run.factoryCalls).toBe(0)
  })
})
