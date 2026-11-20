/**
 * A durable home for pending HITL approvals (usetheokit/theokit#1960).
 *
 * The in-process registry holds a live Promise per approval, so a restart — or a request that lands
 * on another instance — loses it. A deferred approval needs no live Promise: the run ended, the SDK
 * session holds the pending call, and the only thing left to keep is this record, enough to list the
 * approval and to resume the session once a person answers.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { TimeoutAction } from '@theokit/agents'

import type {
  ApprovalDecision,
  ApprovalRegistry,
  PendingApproval,
  RegisterOptions,
} from './approval-registry.js'

/** One pending approval, as persisted. `schemaVersion` lets a later release change the shape. */
export interface StoredApproval {
  readonly schemaVersion: 1
  readonly approvalId: string
  readonly agentName: string
  readonly sessionId: string
  readonly toolUseId: string
  readonly toolName: string
  readonly question?: string
  readonly owner?: string
  /** Epoch ms after which `onTimeout` applies. */
  readonly expiresAt: number
  readonly onTimeout: TimeoutAction
  readonly payloadSchema?: Record<string, unknown>
}

/**
 * Where pending approvals live. Implement it over Redis or a database for a deploy whose instances
 * share no filesystem.
 *
 * `claim` is optional: it removes the record and returns it ONLY to the one caller that got there
 * first, which is what stops two instances resuming the same approval. A store without it falls
 * back to `get` + `delete`, which is not atomic.
 */
export interface ApprovalStore {
  put(record: StoredApproval): Promise<void>
  get(approvalId: string): Promise<StoredApproval | undefined>
  delete(approvalId: string): Promise<void>
  list(): Promise<readonly StoredApproval[]>
  claim?(approvalId: string): Promise<StoredApproval | undefined>
}

const SAFE_ID = /^[A-Za-z0-9._-]+$/

function fileFor(dir: string, approvalId: string): string {
  // The id arrives from a URL: refuse anything that could leave `dir`.
  if (!SAFE_ID.test(approvalId) || approvalId.startsWith('.')) {
    throw new Error(`invalid approval id '${approvalId}'`)
  }
  return join(dir, `${approvalId}.json`)
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

async function readRecord(file: string): Promise<StoredApproval | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as StoredApproval
  } catch (err) {
    if (isMissing(err)) return undefined
    throw err
  }
}

/** One `<approvalId>.json` per approval in `dir`, written atomically (temp file + rename), mode 0600. */
export function createFileApprovalStore(dir: string): ApprovalStore {
  return {
    async put(record) {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const file = fileFor(dir, record.approvalId)
      const tmp = `${file}.${randomUUID()}.tmp`
      await writeFile(tmp, JSON.stringify(record), { mode: 0o600 })
      await rename(tmp, file)
    },
    async get(approvalId) {
      if (!SAFE_ID.test(approvalId)) return undefined
      return readRecord(fileFor(dir, approvalId))
    },
    async delete(approvalId) {
      if (!SAFE_ID.test(approvalId)) return
      await unlink(fileFor(dir, approvalId)).catch((err: unknown) => {
        if (!isMissing(err)) throw err
      })
    },
    async list() {
      let names: string[]
      try {
        names = await readdir(dir)
      } catch (err) {
        if (isMissing(err)) return []
        throw err
      }
      const records = await Promise.all(
        names.filter((n) => n.endsWith('.json')).map((n) => readRecord(join(dir, n))),
      )
      return records.filter((r): r is StoredApproval => r !== undefined)
    },
    async claim(approvalId) {
      if (!SAFE_ID.test(approvalId)) return undefined
      const file = fileFor(dir, approvalId)
      const mine = `${file}.${randomUUID()}.claimed`
      // `rename` is atomic: of several callers, exactly one moves the file.
      try {
        await rename(file, mine)
      } catch (err) {
        if (isMissing(err)) return undefined
        throw err
      }
      try {
        return JSON.parse(await readFile(mine, 'utf8')) as StoredApproval
      } finally {
        await unlink(mine).catch(() => undefined)
      }
    },
  }
}

/** A registry whose pending approvals live in `store`. Declares `scope: 'shared'`. */
export function createDurableApprovalRegistry(store: ApprovalStore): ApprovalRegistry {
  return {
    scope: 'shared',
    store,
    // A durable approval is never awaited in-process: the run ends deferred and the record is
    // answered by a later request. Refuse loudly rather than hang a run that nothing can resolve.
    register(_approvalId: string, _opts: RegisterOptions): Promise<ApprovalDecision> {
      return Promise.reject(
        new Error(
          'a durable approval registry defers gated calls; it cannot await them in-process',
        ),
      )
    },
    resolve: () => false,
    list: (): PendingApproval[] => [],
    ownerOf: () => undefined,
  }
}
