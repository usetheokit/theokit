import type { Envelope } from './relay-crypto.js'

/**
 * B-694 (OC-14) — the relay's mailbox: store and forward by recipient public key. It holds
 * `Envelope`s only, so it has no key that could read one. Bounded per recipient.
 */
export class RelayMailbox {
  private readonly boxes = new Map<string, Envelope[]>()

  constructor(private readonly maxPerRecipient = 100) {}

  put(envelope: Envelope): void {
    const box = this.boxes.get(envelope.to) ?? []
    if (box.length >= this.maxPerRecipient) throw new Error('relay: the mailbox is full')
    box.push(envelope)
    this.boxes.set(envelope.to, box)
  }

  /** Hands over and clears everything waiting for `recipient`. */
  take(recipient: string): Envelope[] {
    const box = this.boxes.get(recipient) ?? []
    this.boxes.delete(recipient)
    return box
  }
}
