import { afterEach, describe, expect, it, vi } from 'vitest'

import { announceOnLan, serviceName, stopThenClose } from '../src/discovery/lan-announcer.js'
import type { LanAnnouncement } from '../src/discovery/lan-announcer.js'
import { type PublishedService, type PublisherFactory, TheoClawDiscoveryError } from '../src/discovery/publisher.js'
import type { DiscoveryMode, ServicePublisher } from '../src/discovery/publisher.js'

/** What the fake publisher does on each call; every call is recorded in one shared log. */
interface FakeBehaviour {
  unpublishAll?: () => Promise<void>
  destroy?: () => Promise<void>
}

function fakeFactory(behaviour: FakeBehaviour = {}) {
  const calls: string[] = []
  const published: PublishedService[] = []
  let onError: ((error: TheoClawDiscoveryError) => void) | undefined
  let created = 0
  const createPublisher: PublisherFactory = (options) => {
    created += 1
    onError = options.onError
    const publisher: ServicePublisher = {
      publish: (service) => {
        calls.push('publish')
        published.push(service)
      },
      unpublishAll: () => {
        calls.push('unpublishAll')
        return behaviour.unpublishAll?.() ?? Promise.resolve()
      },
      destroy: () => {
        calls.push('destroy')
        return behaviour.destroy?.() ?? Promise.resolve()
      },
    }
    return publisher
  }
  return {
    createPublisher,
    calls,
    published,
    get created() {
      return created
    },
    fail(error: TheoClawDiscoveryError) {
      onError?.(error)
    },
  }
}

function fakeHandle(host: string, port: number, calls: string[] = []) {
  return {
    address: () => ({ host, port }),
    close: () => {
      calls.push('close')
      return Promise.resolve()
    },
  }
}

function announce(
  fake: ReturnType<typeof fakeFactory>,
  options: { host?: string; port?: number; mode?: DiscoveryMode; hostname?: string } = {},
) {
  const lines: string[] = []
  const handle = fakeHandle(options.host ?? '192.168.2.111', options.port ?? 41001, fake.calls)
  const announcement = announceOnLan(handle, {
    mode: options.mode ?? 'on',
    log: (line) => void lines.push(line),
    createPublisher: fake.createPublisher,
    hostname: () => options.hostname ?? 'paulo',
  })
  return { announcement, handle, lines }
}

function discoveryError(code: string): TheoClawDiscoveryError {
  return new TheoClawDiscoveryError(Object.assign(new Error(code), { code }), 'socket')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('announceOnLan', () => {
  it('announces the address and port read from the socket, not the environment', () => {
    vi.stubEnv('THEOCLAW_PORT', '9999')
    vi.stubEnv('THEOCLAW_HOST', '127.0.0.1')
    const fake = fakeFactory()

    announce(fake, { host: '192.168.2.111', port: 41001 })

    expect(fake.calls).toEqual(['publish'])
    expect(fake.published[0]?.port).toBe(41001)
  })

  for (const host of ['127.0.0.1', '::1']) {
    it(`creates no publisher when bound to ${host}`, () => {
      const fake = fakeFactory()

      const { lines } = announce(fake, { host })

      expect(fake.created).toBe(0)
      expect(lines).toEqual([`LAN discovery is off: TheoClaw is bound to ${host}`])
    })
  }

  it('publishes _theoclaw._tcp with the bound port and path=/control and no token', () => {
    const controlToken = 'c'.repeat(32)
    const webchatToken = 'w'.repeat(32)
    vi.stubEnv('THEOCLAW_CONTROL_TOKEN', controlToken)
    vi.stubEnv('THEOCLAW_WEBCHAT_TOKEN', webchatToken)
    const fake = fakeFactory()

    const { lines } = announce(fake, { port: 41001 })

    expect(fake.published).toEqual([
      { name: 'TheoClaw on paulo port 41001', type: 'theoclaw', port: 41001, txt: { path: '/control' } },
    ])
    const sent = JSON.stringify(fake.published)
    expect(sent).not.toContain(controlToken)
    expect(sent).not.toContain(webchatToken)
    expect(lines).toEqual(['LAN discovery: publishing "TheoClaw on paulo port 41001" as _theoclaw._tcp'])
  })

  it('THEOCLAW_MDNS=off creates no publisher on a LAN address', () => {
    const fake = fakeFactory()

    const { lines } = announce(fake, { mode: 'off' })

    expect(fake.created).toBe(0)
    expect(lines).toEqual(['LAN discovery is off: THEOCLAW_MDNS=off'])
  })

  it('THEOCLAW_MDNS=off on a loopback bind logs the THEOCLAW_MDNS line', () => {
    const fake = fakeFactory()

    const { lines } = announce(fake, { mode: 'off', host: '127.0.0.1' })

    expect(fake.created).toBe(0)
    expect(lines).toEqual(['LAN discovery is off: THEOCLAW_MDNS=off'])
  })

  it('stop unpublishes and destroys the publisher before the listener closes', async () => {
    const fake = fakeFactory()
    const { announcement, handle } = announce(fake)

    await stopThenClose(announcement, handle)

    expect(fake.calls).toEqual(['publish', 'unpublishAll', 'destroy', 'close'])
  })

  it('stop still destroys the publisher when unpublishAll never calls back', async () => {
    vi.useFakeTimers()
    const fake = fakeFactory({ unpublishAll: () => new Promise<void>(() => undefined) })
    const { announcement } = announce(fake)

    let stopped = false
    const stopping = announcement.stop().then(() => (stopped = true))
    await vi.advanceTimersByTimeAsync(1000)
    await stopping

    expect(stopped).toBe(true)
    expect(fake.calls).toEqual(['publish', 'unpublishAll', 'destroy'])
  })

  it('logs TheoClawDiscoveryError once and keeps the listener open', async () => {
    const fake = fakeFactory()
    const { announcement, lines } = announce(fake)

    fake.fail(discoveryError('EADDRINUSE'))
    fake.fail(discoveryError('EADDRINUSE'))
    await announcement.stop()

    const failures = lines.filter((line) => line.includes('TheoClawDiscoveryError'))
    expect(failures).toEqual([
      'TheoClawDiscoveryError: LAN discovery stopped (EADDRINUSE); TheoClaw keeps serving on 192.168.2.111:41001',
    ])
    expect(fake.calls.filter((call) => call === 'destroy')).toHaveLength(1)
    expect(fake.calls).not.toContain('close')
  })

  it('a publisher factory that throws is logged as TheoClawDiscoveryError and nothing else fails', async () => {
    const lines: string[] = []
    const calls: string[] = []
    const announcement = announceOnLan(fakeHandle('192.168.2.111', 41001, calls), {
      mode: 'on',
      log: (line) => void lines.push(line),
      createPublisher: () => {
        throw Object.assign(new Error('no socket'), { code: 'EPERM' })
      },
      hostname: () => 'paulo',
    })
    await announcement.stop()

    expect(lines).toEqual([
      'TheoClawDiscoveryError: LAN discovery stopped (EPERM); TheoClaw keeps serving on 192.168.2.111:41001',
    ])
    expect(calls).not.toContain('close')
  })

  it('stop resolves when destroy throws or never calls back', async () => {
    vi.useFakeTimers()
    const throwing = fakeFactory({ destroy: () => Promise.reject(Object.assign(new Error('gone'), { code: 'ERR_SOCKET_DGRAM_NOT_RUNNING' })) })
    const first = announce(throwing)
    await first.announcement.stop()
    expect(first.lines.filter((line) => line.startsWith('TheoClawDiscoveryError'))).toEqual([
      'TheoClawDiscoveryError: LAN discovery stopped (ERR_SOCKET_DGRAM_NOT_RUNNING); TheoClaw keeps serving on 192.168.2.111:41001',
    ])

    const hanging = fakeFactory({ destroy: () => new Promise<void>(() => undefined) })
    const second = announce(hanging)
    let stopped = false
    const stopping = second.announcement.stop().then(() => (stopped = true))
    await vi.advanceTimersByTimeAsync(1000)
    await stopping
    expect(stopped).toBe(true)
  })

  it('a failure followed by a rejected goodbye still writes one line', async () => {
    const fake = fakeFactory({ unpublishAll: () => Promise.reject(discoveryError('EACCES')) })
    const { announcement, lines } = announce(fake)

    fake.fail(discoveryError('EACCES'))
    await announcement.stop()

    expect(lines.filter((line) => line.startsWith('TheoClawDiscoveryError'))).toHaveLength(1)
    expect(fake.calls.filter((call) => call === 'destroy')).toHaveLength(1)
  })

  it('an unpublishAll that rejects is logged once and stop still destroys', async () => {
    const goodbye = new TheoClawDiscoveryError(Object.assign(new Error('send'), { code: 'EACCES' }), 'send-respond')
    const fake = fakeFactory({ unpublishAll: () => Promise.reject(goodbye) })
    const { announcement, lines } = announce(fake)

    await announcement.stop()

    const failures = lines.filter((line) => line.startsWith('TheoClawDiscoveryError'))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('EACCES')
    expect(fake.calls.filter((call) => call === 'destroy')).toHaveLength(1)
  })

  it('concurrent stops and an error during stop withdraw the service once', async () => {
    let release = (): void => undefined
    const fake = fakeFactory({ unpublishAll: () => new Promise<void>((resolve) => (release = resolve)) })
    const { announcement, lines } = announce(fake)

    const stops = Promise.all([announcement.stop(), announcement.stop(), announcement.stop()])
    fake.fail(discoveryError('EACCES'))
    fake.fail(discoveryError('EACCES'))
    release()
    await stops

    expect(fake.calls.filter((call) => call === 'unpublishAll')).toHaveLength(1)
    expect(fake.calls.filter((call) => call === 'destroy')).toHaveLength(1)
    expect(lines.filter((line) => line.startsWith('TheoClawDiscoveryError'))).toHaveLength(1)
  })

  it('a dotted hostname publishes its first label', () => {
    const fake = fakeFactory()

    announce(fake, { hostname: 'mbp.local' })

    expect(fake.published[0]?.name).toBe('TheoClaw on mbp port 41001')
  })

  it('two instances on two ports publish two names', () => {
    const fake = fakeFactory()

    announce(fake, { port: 41001 })
    announce(fake, { port: 41002 })

    const names = fake.published.map((service) => service.name)
    expect(new Set(names).size).toBe(2)
  })
})

describe('serviceName', () => {
  it('a long hostname is cut so the name stays within 63 bytes and keeps its port', () => {
    for (const host of ['h'.repeat(60), 'é'.repeat(40)]) {
      const name = serviceName(host, 65535)
      expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63)
      expect(name.endsWith(' port 65535')).toBe(true)
      expect(name).not.toContain('�')
    }
    const forty = 'a'.repeat(40)
    expect(serviceName(forty, 65535)).toBe(`TheoClaw on ${forty} port 65535`)
  })
})

describe('stopThenClose', () => {
  it('closes the listener even when the announcement had nothing to stop', async () => {
    const calls: string[] = []
    const noop: LanAnnouncement = { stop: () => Promise.resolve() }

    await stopThenClose(noop, fakeHandle('127.0.0.1', 1, calls))

    expect(calls).toEqual(['close'])
  })
})
