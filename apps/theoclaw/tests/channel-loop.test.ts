import { describe, expect, it } from 'vitest'

import type { GatewayHandler, PlatformName } from '@theokit/gateway'

import { maskSecrets, startChannelLoop } from '../src/channels/channel-loop.js'
import type { ChannelLoop, PlatformBuild } from '../src/channels/channel-loop.js'
import { FakeAdapter, TEN_PLATFORMS, deferred, messageEvent, waitFor } from './fakes.js'

interface Harness {
  readonly loop: ChannelLoop
  readonly adapters: ReadonlyMap<PlatformName, FakeAdapter>
  readonly lines: string[]
  readonly handled: string[]
}

/** Start the loop over ten FakeAdapters; `overrides` replaces the adapter of a platform. */
function startTen(
  overrides: Partial<Record<PlatformName, FakeAdapter>> = {},
  options: { handler?: GatewayHandler; startTimeoutMs?: number } = {},
): Harness {
  const adapters = new Map<PlatformName, FakeAdapter>()
  for (const platform of TEN_PLATFORMS) adapters.set(platform, overrides[platform] ?? new FakeAdapter(platform))
  const lines: string[] = []
  const handled: string[] = []
  const handler: GatewayHandler =
    options.handler ??
    (async (event) => {
      handled.push(`${event.platform}:${event.text}`)
    })
  const platforms: PlatformBuild[] = TEN_PLATFORMS.map((platform) => ({
    platform,
    build: () => adapters.get(platform) as FakeAdapter,
  }))
  const loop = startChannelLoop({
    platforms,
    handler,
    secrets: [],
    write: (line) => lines.push(line),
    ...(options.startTimeoutMs === undefined ? {} : { startTimeoutMs: options.startTimeoutMs }),
  })
  return { loop, adapters, lines, handled }
}

function disconnectsOf(harness: Harness, except: PlatformName): number[] {
  return [...harness.adapters].filter(([platform]) => platform !== except).map(([, adapter]) => adapter.disconnects)
}

describe('startChannelLoop', () => {
  it("starts the other runners when one adapter's connect returns false", async () => {
    const harness = startTen({ discord: new FakeAdapter('discord', { connect: async () => false }) })

    await harness.loop.ready

    expect(harness.loop.started.size).toBe(9)
    expect(harness.loop.failed).toEqual(['discord'])
    expect(disconnectsOf(harness, 'discord')).toEqual(Array(9).fill(0))
  })

  it('a started runner replies while another failed', async () => {
    const harness = startTen({ discord: new FakeAdapter('discord', { connect: async () => false }) })
    await harness.loop.ready

    const outcome = await harness.adapters.get('telegram')?.deliver(messageEvent('telegram', 'hello'))
    await waitFor(() => harness.handled.length === 1, 1000, 'the telegram handler to run')

    expect(outcome).toBe('ok')
    expect(harness.handled).toEqual(['telegram:hello'])
  })

  it('a throwing constructor fails only its platform', async () => {
    const adapters = new Map(TEN_PLATFORMS.map((platform) => [platform, new FakeAdapter(platform)]))
    const lines: string[] = []
    const loop = startChannelLoop({
      platforms: TEN_PLATFORMS.map((platform) => ({
        platform,
        build: () => {
          if (platform === 'sms') throw new Error('SMSAdapter: signing secret missing')
          return adapters.get(platform) as FakeAdapter
        },
      })),
      handler: async () => undefined,
      secrets: [],
      write: (line) => lines.push(line),
    })

    await loop.ready

    expect(loop.started.size).toBe(9)
    expect(loop.failed).toEqual(['sms'])
    expect(lines).toEqual(['sms: start failed: SMSAdapter: signing secret missing'])
  })

  it('stop all stops every started runner', async () => {
    const harness = startTen()
    await harness.loop.ready

    await harness.loop.stopAll()

    expect([...harness.adapters.values()].map((adapter) => adapter.disconnects)).toEqual(Array(10).fill(1))
  })

  it('a connect that never settles holds back only its platform', async () => {
    const harness = startTen(
      { matrix: new FakeAdapter('matrix', { connect: () => new Promise<boolean>(() => {}) }) },
      { startTimeoutMs: 5000 },
    )

    await waitFor(() => harness.loop.started.size === 9, 1000, 'nine platforms to start')

    expect(harness.loop.started.has('matrix')).toBe(false)
    expect(await harness.adapters.get('slack')?.deliver(messageEvent('slack', 'hi'))).toBe('ok')
  })

  it('stop all during startup stops what connected', async () => {
    const held = deferred<boolean>()
    const harness = startTen(
      { email: new FakeAdapter('email', { connect: () => held.promise }) },
      { startTimeoutMs: 5000 },
    )
    await waitFor(() => harness.loop.started.size === 9, 1000, 'nine platforms to start')

    // The held connect is never released: a stopAll that waited for it would never resolve.
    await harness.loop.stopAll()

    expect(disconnectsOf(harness, 'email')).toEqual(Array(9).fill(1))
  })

  it('a pending start connected after stop all is stopped', async () => {
    const held = deferred<boolean>()
    const email = new FakeAdapter('email', { connect: () => held.promise })
    const harness = startTen({ email })
    await waitFor(() => harness.loop.started.size === 9, 1000, 'nine platforms to start')
    await harness.loop.stopAll()

    held.resolve(true)

    await waitFor(() => email.disconnects === 1, 1000, 'the late email adapter to be stopped')
    expect(harness.loop.started.has('email')).toBe(false)
  })

  it('a start that exceeds the timeout is abandoned', async () => {
    const harness = startTen(
      { matrix: new FakeAdapter('matrix', { connect: () => new Promise<boolean>(() => {}) }) },
      { startTimeoutMs: 50 },
    )

    await harness.loop.ready

    expect(harness.loop.failed).toEqual(['matrix'])
    expect(harness.lines).toEqual(['matrix: start timed out after 50 ms'])
  })

  it('an abandoned start that later connects is stopped', async () => {
    const held = deferred<boolean>()
    const matrix = new FakeAdapter('matrix', { connect: () => held.promise })
    const harness = startTen({ matrix }, { startTimeoutMs: 50 })
    await harness.loop.ready

    held.resolve(true)

    await waitFor(() => matrix.disconnects === 1, 1000, 'the abandoned matrix adapter to be stopped')
    expect(harness.loop.started.has('matrix')).toBe(false)
  })

  it('a disconnect that fails does not stop the others', async () => {
    const telegram = new FakeAdapter('telegram')
    const harness = startTen({ telegram })
    await harness.loop.ready
    telegram.disconnect = async () => {
      throw new Error('socket already closed')
    }

    await harness.loop.stopAll()

    expect(disconnectsOf(harness, 'telegram')).toEqual(Array(9).fill(1))
  })

  it('a stopped platform is no longer listed as started', async () => {
    const harness = startTen()
    await harness.loop.ready

    await harness.loop.stopAll()

    expect(harness.loop.started.size).toBe(0)
  })

  it('an abandoned start that later fails is written once, masked', async () => {
    const held = deferred<boolean>()
    const lines: string[] = []
    const loop = startChannelLoop({
      platforms: [{ platform: 'matrix', build: () => new FakeAdapter('matrix', { connect: () => held.promise }) }],
      handler: async () => undefined,
      secrets: ['matrix-secret-value'],
      write: (line) => lines.push(line),
      startTimeoutMs: 50,
    })
    await loop.ready

    held.reject(new Error('sync failed for matrix-secret-value'))

    await waitFor(() => lines.length === 2, 1000, 'the abandoned failure to be written')
    expect(lines).toEqual([
      'matrix: start timed out after 50 ms',
      'matrix: abandoned start failed: sync failed for [redacted]',
    ])
  })

  describe('concurrency', () => {
    it('a failing connect that settles last disconnects none of the nine', async () => {
      const gate = deferred<boolean>()
      const harness = startTen({ discord: new FakeAdapter('discord', { connect: () => gate.promise }) })
      await waitFor(() => harness.loop.started.size === 9, 1000, 'nine platforms to start')

      gate.resolve(false)
      await harness.loop.ready

      expect(harness.loop.failed).toEqual(['discord'])
      expect(disconnectsOf(harness, 'discord')).toEqual(Array(9).fill(0))
    })

    it('five deliveries to one runner all return before any handler finishes', async () => {
      const gate = deferred<void>()
      const harness = startTen({}, { handler: () => gate.promise })
      await harness.loop.ready
      const telegram = harness.adapters.get('telegram') as FakeAdapter

      const outcomes = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => telegram.deliver(messageEvent('telegram', `message ${n}`, `user-${n}`))),
      )

      expect(outcomes).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
      gate.resolve()
      await harness.loop.stopAll()
    })
  })
})

describe('maskSecrets', () => {
  it('masks a value that contains another value whole', () => {
    expect(maskSecrets('key abc-123-xyz and abc', ['abc', 'abc-123-xyz'])).toBe(
      'key [redacted] and [redacted]',
    )
  })

  it('ignores an empty value instead of masking between every character', () => {
    expect(maskSecrets('plain line', [''])).toBe('plain line')
  })
})
