import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { replaceFileAtomic } from '@theokit/sdk/persistence'

import { serializedPerFile } from '../serial-queue.js'
import {
  generateIdentity,
  open,
  seal,
  type Envelope,
  type RelayIdentity,
  type TrustedPeers,
} from './relay-crypto.js'

/**
 * B-694 (OC-14) — one instance's relay state: its identity, the peers it trusts (named by the
 * operator, name -> public key), a send counter per peer and the highest counter accepted from
 * each peer. The file holds the private key and is written 0600; counters are saved before an
 * envelope leaves or a plaintext is returned, so a restart never reuses or re-accepts one.
 * Replay: `receive` accepts a sender's `seq` only if it is above the last accepted one.
 */
interface Persisted {
  identity: RelayIdentity
  sent: Record<string, number>
  received: Record<string, number>
}

export class RelayState {
  private writes: Promise<void> = Promise.resolve()

  private constructor(
    private readonly file: string,
    private readonly data: Persisted,
    readonly trusted: TrustedPeers,
  ) {}

  /** Loads the file or creates an identity on first use. */
  static async load(file: string, trusted: TrustedPeers): Promise<RelayState> {
    // Queued per file: two first loads of a missing file must not each make an identity.
    return serializedPerFile(file, async () => {
      let data: Persisted
      if (existsSync(file)) {
        data = JSON.parse(readFileSync(file, 'utf8')) as Persisted
      } else {
        data = { identity: generateIdentity(), sent: {}, received: {} }
      }
      const state = new RelayState(file, data, trusted)
      await state.save()
      return state
    })
  }

  get publicKey(): string {
    return this.data.identity.publicKey
  }

  /** Snapshots now and writes in call order, so a slow earlier write never lands over a later one. */
  private save(): Promise<void> {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const text = JSON.stringify(this.data)
    const run = this.writes.then(() => replaceFileAtomic(this.file, text, { mode: 0o600 }))
    this.writes = run.catch(() => undefined)
    return run
  }

  /** Seals `text` for the trusted peer `peerName`. */
  async seal(peerName: string, text: string): Promise<Envelope> {
    const key = this.trusted.get(peerName)
    if (key === undefined) throw new Error(`relay: peer "${peerName}" is not trusted`)
    const seq = (this.data.sent[key] ?? 0) + 1
    this.data.sent[key] = seq
    await this.save()
    return seal(this.data.identity, this.trusted, peerName, text, seq)
  }

  /** Opens an envelope; refuses an untrusted sender, a forgery and a replayed or older `seq`. */
  async receive(
    envelope: Envelope,
    onAccepted?: () => void,
  ): Promise<{ readonly from: string; readonly plaintext: string }> {
    const opened = open(this.data.identity, this.trusted, envelope)
    if (
      !Number.isSafeInteger(envelope.seq) ||
      envelope.seq <= (this.data.received[envelope.from] ?? 0)
    ) {
      throw new Error('relay: the envelope is a replay or out of order')
    }
    this.data.received[envelope.from] = envelope.seq
    // The envelope counts as read from here on, before the disk write is waited for.
    onAccepted?.()
    await this.save()
    return opened
  }
}
