import { existsSync, readFileSync } from 'node:fs'

import { replaceFileAtomic } from '@theokit/sdk/persistence'

import { bearerCheck } from '../control-plane/bearer.js'
import type { Envelope } from './relay-crypto.js'

/**
 * B-694 (OC-14) — the relay: a bearer-guarded store-and-forward mailbox over HTTP.
 * `POST /relay/put` takes an `Envelope`; `POST /relay/take` with `{ "to": "<public key>" }` hands
 * over and clears what waits for that key. It holds ciphertext only, so it has no key that could
 * read a message. The bearer token (shared by the instances that use this relay) keeps strangers
 * out; a holder of it can drain a mailbox, which costs availability, never confidentiality.
 * Optionally persisted to a file so a restart keeps queued envelopes.
 */

export const RELAY_PUT_PATH = '/relay/put'
export const RELAY_TAKE_PATH = '/relay/take'
const MAX_BODY_BYTES = 256 * 1024

export function isRelayPath(pathname: string): boolean {
  return pathname === RELAY_PUT_PATH || pathname === RELAY_TAKE_PATH
}

export class RelayMailbox {
  private readonly boxes = new Map<string, Envelope[]>()
  private writes: Promise<void> = Promise.resolve()

  constructor(
    private readonly maxPerRecipient = 100,
    private readonly persistPath?: string,
  ) {
    if (persistPath !== undefined && existsSync(persistPath)) {
      const saved = JSON.parse(readFileSync(persistPath, 'utf8')) as Record<string, Envelope[]>
      for (const [to, box] of Object.entries(saved)) this.boxes.set(to, box)
    }
  }

  /** Snapshots now and writes in call order, so a slow earlier write never lands over a later one. */
  private persist(): Promise<void> {
    const path = this.persistPath
    if (path === undefined) return Promise.resolve()
    const text = JSON.stringify(Object.fromEntries(this.boxes))
    const run = this.writes.then(() => replaceFileAtomic(path, text, { mode: 0o600 }))
    this.writes = run.catch(() => undefined)
    return run
  }

  async put(envelope: Envelope): Promise<void> {
    const box = this.boxes.get(envelope.to) ?? []
    if (box.length >= this.maxPerRecipient) throw new Error('relay: the mailbox is full')
    box.push(envelope)
    this.boxes.set(envelope.to, box)
    await this.persist()
  }

  /** Hands over and clears everything waiting for `recipient`. */
  async take(recipient: string): Promise<Envelope[]> {
    const box = this.boxes.get(recipient) ?? []
    this.boxes.delete(recipient)
    if (box.length > 0) await this.persist()
    return box
  }
}

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    ['to', 'from', 'ephemeral', 'nonce', 'ciphertext'].every((k) => typeof v[k] === 'string') &&
    typeof v.seq === 'number'
  )
}

/** The HTTP route over a mailbox; the token is checked before the body is read. */
export function relayRoute(
  token: string,
  mailbox: RelayMailbox,
): (request: Request) => Promise<Response> {
  const authorize = bearerCheck(token)
  return async (request) => {
    if (request.method !== 'POST')
      return new Response(null, { status: 405, headers: { allow: 'POST' } })
    if (!authorize(request.headers.get('authorization') ?? undefined)) {
      return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer' } })
    }
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 })
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return new Response(null, { status: 400 })
    }
    const { pathname } = new URL(request.url)
    if (pathname === RELAY_PUT_PATH) {
      if (!isEnvelope(body)) return new Response(null, { status: 400 })
      try {
        await mailbox.put(body)
      } catch {
        return new Response(null, { status: 507 })
      }
      return new Response(null, { status: 204 })
    }
    const to = (body as { to?: unknown } | null)?.to
    if (typeof to !== 'string') return new Response(null, { status: 400 })
    return Response.json({ envelopes: await mailbox.take(to) })
  }
}
