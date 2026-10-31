import { randomUUID } from 'node:crypto'
import { once } from 'node:events'

import { Bonjour } from 'bonjour-service'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBonjourPublisher } from '../src/discovery/bonjour-publisher.js'
import { announceOnLan, type LanAnnouncement } from '../src/discovery/lan-announcer.js'
import type { ServicePublisher, TheoClawDiscoveryError } from '../src/discovery/publisher.js'

const DEADLINE_MS = 5000
const POLL_MS = 20
/** Above every deadline below, so a named deadline message is what a failure shows. */
const TEST_TIMEOUT_MS = 15_000
const CONFLICT_LINE = 'Service name is already in use on the network'
/** Any address that is not a loopback, so the announcer publishes; nothing binds it. */
const LAN_HOST = '192.0.2.10'

interface Question {
  readonly name: string
}

/** The part of a plain Bonjour's multicast emitter the race case drives by hand. */
interface ControlledEmitter {
  on(event: 'query', listener: (packet: { readonly questions: readonly Question[] }) => void): unknown
  respond(packet: { answers: readonly unknown[] }, callback?: (error?: unknown) => void): void
}

let holder: Bonjour | undefined
let publisher: ServicePublisher | undefined
let announcement: LanAnnouncement | undefined

afterEach(async () => {
  await announcement?.stop()
  announcement = undefined
  await publisher?.destroy()
  publisher = undefined
  await new Promise<void>((resolve) => (holder ? holder.destroy(() => resolve()) : resolve()))
  holder = undefined
  vi.restoreAllMocks()
})

/** Resolve once `predicate` holds, polling; reject naming `what` when the deadline passes first. */
async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`${what} did not happen within ${DEADLINE_MS} ms`)
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

/** Capture `console.log`, where the library writes its conflict line, and say when that line arrived. */
function captureLibraryLog(): () => boolean {
  const logged: unknown[] = []
  vi.spyOn(console, 'log').mockImplementation((value: unknown) => {
    logged.push(value)
  })
  return () => logged.some((value) => String(value).includes(CONFLICT_LINE))
}

/** A name held by another host on the network: a plain Bonjour that has announced it. */
async function holdName(name: string): Promise<void> {
  holder = new Bonjour()
  const held = holder.publish({ name, type: 'theoclaw', port: 40001 })
  await once(held, 'up')
}

function emitterOf(bonjour: Bonjour): ControlledEmitter {
  return (bonjour as unknown as { readonly server: { readonly mdns: ControlledEmitter } }).server.mdns
}

const routeAndCode = (error: TheoClawDiscoveryError) => ({ route: error.route, code: error.code })

/** B-613 (LCR0101): a DNS-SD name conflict withdraws the service, and the adapter must say so. */
describe('createBonjourPublisher on a name another host already answers for', () => {
  it('reports the withdrawal through onError', async () => {
    const name = `conflict-${randomUUID()}`
    await holdName(name)
    const conflictLogged = captureLibraryLog()
    const errors: TheoClawDiscoveryError[] = []
    publisher = createBonjourPublisher({ onError: (error) => errors.push(error) })
    publisher.publish({ name, type: 'theoclaw', port: 40002, txt: { path: '/control' } })

    // Positive control: the library itself saw the conflict and withdrew the service.
    await waitFor(conflictLogged, 'the library withdrawal')

    expect(errors.map(routeAndCode)).toEqual([{ route: 'publish', code: 'NAME_IN_USE' }])
    expect((errors[0]?.cause as Error).message).toContain(name)
  }, TEST_TIMEOUT_MS)

  it('the announcer logs one stop line on a conflict', async () => {
    const short = randomUUID().slice(0, 8)
    const port = 40003
    const name = `TheoClaw on ${short} port ${port}`
    await holdName(name)
    const conflictLogged = captureLibraryLog()
    const lines: string[] = []
    announcement = announceOnLan(
      { address: () => ({ host: LAN_HOST, port }) },
      { mode: 'on', log: (line) => lines.push(line), createPublisher: createBonjourPublisher, hostname: () => short },
    )

    await waitFor(conflictLogged, 'the library withdrawal')

    expect(lines.filter((line) => line.includes('LAN discovery stopped'))).toEqual([
      `TheoClawDiscoveryError: LAN discovery stopped (NAME_IN_USE); TheoClaw keeps serving on ${LAN_HOST}:${port}`,
    ])
  }, TEST_TIMEOUT_MS)
})

/** FR-003: a withdrawal TheoClaw asked for is not a conflict and reports nothing. */
describe('createBonjourPublisher withdrawing its own service', () => {
  it('reports nothing when shutdown precedes a late answer', async () => {
    const name = `late-${randomUUID()}`
    const fqdn = `${name}._theoclaw._tcp.local`
    holder = new Bonjour()
    const other = emitterOf(holder)
    let queried = false
    other.on('query', (packet) => {
      if (packet.questions.some((question) => question.name === fqdn)) queried = true
    })
    const conflictLogged = captureLibraryLog()
    const errors: TheoClawDiscoveryError[] = []
    publisher = createBonjourPublisher({ onError: (error) => errors.push(error) })
    publisher.publish({ name, type: 'theoclaw', port: 40004, txt: { path: '/control' } })

    await waitFor(() => queried, "the adapter's probe query")
    await publisher.unpublishAll()
    other.respond({ answers: [{ name: fqdn, type: 'SRV', data: { port: 40001, target: 'other.local' } }] })

    // Positive control: the late answer did reach the probe, which then called the service's stop.
    await waitFor(conflictLogged, 'the late conflict answer')

    expect(errors).toEqual([])
  }, TEST_TIMEOUT_MS)

  it('reports nothing on a clean shutdown', async () => {
    const name = `clean-${randomUUID()}`
    holder = new Bonjour()
    const seen: string[] = []
    holder.find({ type: 'theoclaw' }, (service) => seen.push(service.name))
    const errors: TheoClawDiscoveryError[] = []
    publisher = createBonjourPublisher({ onError: (error) => errors.push(error) })
    publisher.publish({ name, type: 'theoclaw', port: 40005, txt: { path: '/control' } })

    await waitFor(() => seen.includes(name), 'the announce')
    await publisher.unpublishAll()
    await publisher.destroy()
    publisher = undefined

    expect(errors).toEqual([])
  }, TEST_TIMEOUT_MS)
})
