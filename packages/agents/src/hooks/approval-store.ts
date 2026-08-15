/**
 * The producer for the `approved` set that `buildHookHandlers` requires.
 *
 * ## Why this exists
 *
 * The gate shipped without it. `buildHookHandlers` takes `approved` as a REQUIRED argument and
 * denies by default — deliberately, because a hook is `spawn(cmd, { shell: true, detached: true })`
 * on every tool call. But nothing in the framework produced that set, which left a consumer two
 * exits: approve everything, or write the store themselves. They wrote it. The half they had to
 * write is the half that touches directory modes and atomic replacement — precisely where a store of
 * this sensitivity gets it wrong, and precisely what a framework should not make each consumer
 * rediscover.
 *
 * ## Three states, because two would throw away the signal
 *
 * `approved` / `unknown` / **`modified`**. The fingerprint covers the command, so an edited command
 * yields a NEW fingerprint that is simply absent — indistinguishable from a hook nobody ever saw.
 * Keeping the approved command alongside its fingerprint is what lets the store say "this was
 * approved, and then someone changed it", which is the whole reason the gate is keyed by fingerprint
 * rather than by name.
 *
 * A class rather than free functions: there is state (the loaded records), an injectable location
 * for tests, and an error to carry between a read and the caller that surfaces it.
 */
import { join } from 'node:path'

import { hookFingerprint, type HookIdentity } from './hook-fingerprint.js'
import { readSecureJson, writeSecureJson } from './secure-store.js'

/** What the store can say about a hook it is asked to judge. */
export type ApprovalState = 'approved' | 'unknown' | 'modified'

/** One approval, as persisted. The command is kept so `modified` is distinguishable from `unknown`. */
interface ApprovalRecord {
  readonly fingerprint: string
  readonly command: string
  readonly event: string
  readonly matcher?: string
  readonly approvedAt: string
}

export interface HookApprovalStoreOptions {
  /** Root under which `.theokit/hook-approvals.json` lives. Injectable so tests never touch `~`. */
  readonly home: string
}

/** Identity minus the command — what stays stable when someone edits what runs. */
function slotOf(identity: Pick<HookIdentity, 'event' | 'matcher'>): string {
  return `${identity.event}${identity.matcher ?? ''}`
}

export class HookApprovalStore {
  /** Absolute path of the backing file. Public so a test can corrupt it deliberately. */
  readonly path: string

  /**
   * Why the last read failed, when it did.
   *
   * Carried rather than thrown: a corrupt store must not take down the turn, and must not read as
   * "no approvals yet" either — the operator needs to learn that every approval stopped applying.
   */
  lastReadError?: Error

  #records: Map<string, ApprovalRecord> | undefined

  constructor(options: HookApprovalStoreOptions) {
    this.path = join(options.home, '.theokit', 'hook-approvals.json')
  }

  /** The set `buildHookHandlers` takes as `approved`. */
  approvedFingerprints(): ReadonlySet<string> {
    return new Set(this.#load().keys())
  }

  stateOf(identity: HookIdentity): ApprovalState {
    const records = this.#load()
    if (records.has(hookFingerprint(identity))) return 'approved'

    // Absent fingerprint, but this event+matcher slot WAS approved under a different command: the
    // command changed after approval. That is a different fact from "never seen", and the only one
    // that means somebody edited something behind a grant.
    const slot = slotOf(identity)
    for (const record of records.values()) {
      if (slotOf(record) === slot && record.command !== identity.command) return 'modified'
    }
    return 'unknown'
  }

  approve(identity: HookIdentity): void {
    const records = this.#load()
    records.set(hookFingerprint(identity), {
      fingerprint: hookFingerprint(identity),
      command: identity.command,
      event: identity.event,
      ...(identity.matcher === undefined ? {} : { matcher: identity.matcher }),
      approvedAt: new Date().toISOString(),
    })
    this.#persist(records)
  }

  revoke(identity: HookIdentity): void {
    const records = this.#load()
    if (records.delete(hookFingerprint(identity))) this.#persist(records)
  }

  /**
   * Read from disk on every call rather than caching across instances.
   *
   * Two processes (a CLI and a TUI) both hold a store, and a cached view would let one keep granting
   * against approvals the other revoked. A consent decision is worth a stat.
   */
  #load(): Map<string, ApprovalRecord> {
    const { value, error } = readSecureJson<ApprovalRecord[]>(
      this.path,
      (raw) => {
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) throw new Error('expected an array of approval records')
        return parsed as ApprovalRecord[]
      },
      [],
    )
    this.lastReadError = error
    this.#records = new Map(value.map((record) => [record.fingerprint, record]))
    return this.#records
  }

  #persist(records: Map<string, ApprovalRecord>): void {
    writeSecureJson(this.path, () => `${JSON.stringify([...records.values()], null, 2)}\n`)
  }
}
