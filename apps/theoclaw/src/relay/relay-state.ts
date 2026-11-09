import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

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
  private constructor(
    private readonly file: string,
    private readonly data: Persisted,
    readonly trusted: TrustedPeers,
  ) {}

  /** Loads the file or creates an identity on first use. */
  static load(file: string, trusted: TrustedPeers): RelayState {
    let data: Persisted
    if (existsSync(file)) {
      data = JSON.parse(readFileSync(file, 'utf8')) as Persisted
    } else {
      data = { identity: generateIdentity(), sent: {}, received: {} }
    }
    const state = new RelayState(file, data, trusted)
    state.save()
    return state
  }

  get publicKey(): string {
    return this.data.identity.publicKey
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = `${this.file}.tmp`
    writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, this.file)
  }

  /** Seals `text` for the trusted peer `peerName`. */
  seal(peerName: string, text: string): Envelope {
    const key = this.trusted.get(peerName)
    if (key === undefined) throw new Error(`relay: peer "${peerName}" is not trusted`)
    const seq = (this.data.sent[key] ?? 0) + 1
    this.data.sent[key] = seq
    this.save()
    return seal(this.data.identity, this.trusted, peerName, text, seq)
  }

  /** Opens an envelope; refuses an untrusted sender, a forgery and a replayed or older `seq`. */
  receive(envelope: Envelope): { readonly from: string; readonly plaintext: string } {
    const opened = open(this.data.identity, this.trusted, envelope)
    if (
      !Number.isSafeInteger(envelope.seq) ||
      envelope.seq <= (this.data.received[envelope.from] ?? 0)
    ) {
      throw new Error('relay: the envelope is a replay or out of order')
    }
    this.data.received[envelope.from] = envelope.seq
    this.save()
    return opened
  }
}
