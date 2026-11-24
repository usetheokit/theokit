import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  generateA2AIdentity,
  jsonSequenceStore,
  sealedTransport,
  type A2AIdentity,
  type A2ATransport,
  type SequenceStore,
  type TrustedPeers,
} from '@theokit/sdk/a2a'
import { replaceFileAtomic, withFileLock } from '@theokit/sdk/persistence'


/**
 * B-694 (OC-14) — one instance's relay state: its identity and the peers it trusts (named by the
 * operator, name -> public key). The cryptography, the send counters and the replay check are the
 * SDK's `sealedTransport` and `jsonSequenceStore`; this file only keeps the identity (0600) and
 * points the SDK at a counter file beside it. A turn gate hook marks a message as read as soon as
 * the SDK accepts its sequence, before the counter write is waited for.
 */
export const RELAY_MESSAGE_TYPE = 'theoclaw.relay'

interface Persisted {
  identity: A2AIdentity
  /** Counters of the version that kept them here; moved to the SDK counter file on load. */
  sent?: Record<string, number>
  received?: Record<string, number>
}

/** The counter file that sits beside the identity file. */
function sequencesFile(file: string): string {
  return file.replace(/\.json$/, '') + '-sequences.json'
}

export class RelayState {
  private constructor(
    private readonly identity: A2AIdentity,
    private readonly sequences: SequenceStore,
    readonly trusted: TrustedPeers,
  ) {}

  /** Loads the identity file or creates an identity on first use. */
  static async load(file: string, trusted: TrustedPeers): Promise<RelayState> {
    // Queued per file: two first loads of a missing file must not each make an identity.
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    return withFileLock(resolve(file), async () => {
      const data: Persisted = existsSync(file)
        ? (JSON.parse(readFileSync(file, 'utf8')) as Persisted)
        : { identity: generateA2AIdentity() }
      const counters = sequencesFile(file)
      // Counters written by the earlier relay format carry over, so no counter is reused or re-accepted.
      if (!existsSync(counters) && (data.sent !== undefined || data.received !== undefined)) {
        await replaceFileAtomic(
          counters,
          JSON.stringify({ sent: data.sent ?? {}, received: data.received ?? {} }),
          { mode: 0o600 },
        )
      }
      await replaceFileAtomic(file, JSON.stringify({ identity: data.identity }), { mode: 0o600 })
      return new RelayState(data.identity, jsonSequenceStore(counters), trusted)
    })
  }

  get publicKey(): string {
    return this.identity.publicKey
  }

  private sealed(inner: A2ATransport, sequences: SequenceStore = this.sequences): A2ATransport {
    return sealedTransport(inner, {
      identity: this.identity,
      trustedPeers: this.trusted,
      sequences,
    })
  }

  /** Seals `text` for the trusted peer `peerName` and hands it to `inner`. */
  async send(inner: A2ATransport, peerName: string, text: string): Promise<void> {
    await this.sealed(inner).send({
      type: RELAY_MESSAGE_TYPE,
      payload: text,
      from: this.publicKey,
      to: peerName,
      timestamp: Date.now(),
    })
  }

  /**
   * Fetches and opens what waits. The SDK drops an untrusted sender, a forgery and a replay.
   * `onAccepted` runs when a message authenticated and its sequence is about to be recorded.
   */
  async receive(
    inner: A2ATransport,
    onAccepted?: () => void,
  ): Promise<{ readonly from: string; readonly plaintext: string }[]> {
    // Trade-off: the SDK calls `acceptReceived` only after a message authenticated from a trusted
    // peer, but before it knows the sequence is fresh. Closing the gate here is what lets it close
    // before the counter write ends; the cost is that a replayed (then dropped) message also closes
    // it for the rest of the turn. The gate errs towards withholding a send, never towards allowing one.
    const sequences: SequenceStore = {
      nextSent: (peer) => this.sequences.nextSent(peer),
      acceptReceived: (peer, seq) => {
        onAccepted?.()
        return this.sequences.acceptReceived(peer, seq)
      },
    }
    const messages = await this.sealed(inner, sequences).poll(this.publicKey)
    return messages
      .filter((m) => m.type === RELAY_MESSAGE_TYPE && typeof m.payload === 'string')
      .map((m) => ({ from: m.from, plaintext: m.payload as string }))
  }
}
