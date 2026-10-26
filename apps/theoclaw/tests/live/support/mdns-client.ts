import { randomUUID } from 'node:crypto'
import dgram from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { performance } from 'node:perf_hooks'

import dnsPacket from 'dns-packet'

const MDNS_GROUP = '224.0.0.251'
const MDNS_PORT = 5353

/** One SRV record seen on the group, with the time it was received (`performance.now()`). */
export interface SrvAnswer {
  readonly name: string
  readonly port: number
  readonly ttl: number
  readonly at: number
}

/** A socket on the mDNS group that keeps every SRV record it decodes, so a wait also sees earlier ones. */
export interface MdnsSocket {
  readonly records: readonly SrvAnswer[]
  send(packet: dnsPacket.Packet): void
  onRecord(listener: (record: SrvAnswer) => void): () => void
  close(): Promise<void>
}

function nonInternalIPv4(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

/** Join the group on the default interface and on every non-internal IPv4 one; an interface that refuses is skipped. */
function joinGroup(socket: dgram.Socket): void {
  socket.addMembership(MDNS_GROUP)
  for (const address of nonInternalIPv4()) {
    try {
      socket.addMembership(MDNS_GROUP, address)
    } catch {
      // Already joined through the default interface, or an interface without multicast: the
      // default membership above is the one the test relies on.
    }
  }
  socket.setMulticastLoopback(true)
}

async function bindGroupSocket(): Promise<dgram.Socket> {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(MDNS_PORT, '0.0.0.0', () => {
      socket.off('error', reject)
      resolve()
    })
  })
  joinGroup(socket)
  return socket
}

function decode(message: Buffer): dnsPacket.DecodedPacket | undefined {
  try {
    return dnsPacket.decode(message)
  } catch {
    // Foreign or malformed traffic on the group is not this test's concern.
    return undefined
  }
}

function closeSocket(socket: dgram.Socket): Promise<void> {
  return new Promise((resolve) => socket.close(() => resolve()))
}

/** Bound and joined before it resolves, so a caller can open it before starting what it observes. */
export async function openMdnsSocket(): Promise<MdnsSocket> {
  const socket = await bindGroupSocket()
  const records: SrvAnswer[] = []
  const listeners = new Set<(record: SrvAnswer) => void>()
  socket.on('message', (message) => {
    const at = performance.now()
    const packet = decode(message)
    if (packet?.type !== 'response') return
    for (const answer of [...(packet.answers ?? []), ...(packet.additionals ?? [])]) {
      if (answer.type !== 'SRV') continue
      const record = { name: answer.name.toLowerCase(), port: answer.data.port, ttl: answer.ttl ?? 0, at }
      records.push(record)
      for (const listener of listeners) listener(record)
    }
  })
  return {
    records,
    send: (packet) => socket.send(dnsPacket.encode(packet), MDNS_PORT, MDNS_GROUP),
    onRecord: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: () => closeSocket(socket),
  }
}

/** Ask the group for `name`'s SRV record; returns the send time. */
export function querySrv(socket: MdnsSocket, name: string): number {
  const sent = performance.now()
  socket.send({ type: 'query', id: 0, questions: [{ name, type: 'SRV' }] })
  return sent
}

/** The first SRV record for `name` with a TTL above 0 received after `after`, or a rejection naming the wait. */
export function waitForSrv(
  socket: MdnsSocket,
  name: string,
  options: { readonly after: number; readonly withinMs: number },
): Promise<SrvAnswer> {
  const wanted = name.toLowerCase()
  const matches = (record: SrvAnswer): boolean => record.name === wanted && record.ttl > 0 && record.at > options.after
  const seen = socket.records.find(matches)
  if (seen !== undefined) return Promise.resolve(seen)
  return new Promise((resolve, reject) => {
    const remove = socket.onRecord((record) => {
      if (!matches(record)) return
      clearTimeout(timer)
      remove()
      resolve(record)
    })
    const timer = setTimeout(() => {
      remove()
      reject(new Error(`no SRV record for ${name} within ${options.withinMs} ms`))
    }, options.withinMs)
  })
}

/**
 * Query `name` and the control's name, then collect for `windowMs`: the window is the behaviour
 * under test (NFR-002), opened by the queries. Fails when the control went unanswered, since a
 * silence means nothing on a group nobody can hear. Goodbye records (TTL 0) are counted apart.
 */
export async function expectNoSrv(
  socket: MdnsSocket,
  name: string,
  options: { readonly windowMs: number; readonly control: { readonly name: string } },
): Promise<{ readonly answers: readonly SrvAnswer[]; readonly goodbyes: number }> {
  const sent = querySrv(socket, name)
  querySrv(socket, options.control.name)
  await new Promise((resolve) => setTimeout(resolve, options.windowMs))
  const wanted = name.toLowerCase()
  const inWindow = socket.records.filter((record) => record.at >= sent)
  if (!inWindow.some((record) => record.name === options.control.name.toLowerCase() && record.ttl > 0)) {
    throw new Error(`the control responder ${options.control.name} was not answered within ${options.windowMs} ms`)
  }
  const forName = inWindow.filter((record) => record.name === wanted)
  return { answers: forName.filter((record) => record.ttl > 0), goodbyes: forName.filter((record) => record.ttl === 0).length }
}

/** A responder for a run-unique name, so a silence for TheoClaw's name is measured on a group that answers. */
export async function startControlResponder(): Promise<{ readonly name: string; close(): Promise<void> }> {
  const name = `control-${randomUUID()}._theoclaw-test._tcp.local`
  const socket = await bindGroupSocket()
  socket.on('message', (message) => {
    const packet = decode(message)
    if (packet?.type !== 'query') return
    if (!(packet.questions ?? []).some((question) => question.name.toLowerCase() === name)) return
    const answer = dnsPacket.encode({
      type: 'response',
      id: 0,
      flags: dnsPacket.AUTHORITATIVE_ANSWER,
      answers: [{ name, type: 'SRV', ttl: 120, data: { port: 9, target: 'control.local' } }],
    })
    socket.send(answer, MDNS_PORT, MDNS_GROUP)
  })
  return { name, close: () => closeSocket(socket) }
}
