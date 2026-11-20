import { appendFile, chmod, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { PermissionQuery } from './permission-store.js'

/** One receipt: who decided what, for which call. */
export interface ApprovalRecord {
  /** ISO timestamp of the decision. */
  readonly at: string
  readonly runId: string
  readonly agentId: string
  readonly tool: string
  /** Absent when the call could not be classified or is not governed. */
  readonly query?: PermissionQuery
  readonly allowed: boolean
  /** `'waiver' | 'saved' | 'reviewer' | 'person' | 'person:<id>' | 'none'`. */
  readonly decidedBy: string
  readonly reason: string
}

/** Append-only sink for decision receipts. */
export interface ApprovalLedger {
  append(record: ApprovalRecord): Promise<void>
}

/**
 * An append-only JSON Lines ledger in `dir` (created on demand, file mode 0600).
 * `read()` throws on a damaged line rather than skipping it: a ledger that hides damage is not a record.
 */
export function createJsonlLedger(
  dir: string,
  options: { fileName?: string } = {},
): ApprovalLedger & { read(): Promise<ApprovalRecord[]> } {
  const path = join(dir, options.fileName ?? 'activity.jsonl')
  return {
    async append(record: ApprovalRecord): Promise<void> {
      await mkdir(dir, { recursive: true })
      // `mode` only applies at creation, so tighten a pre-existing wider file BEFORE writing to it:
      // the new receipt must never sit in a file others can read, and a failed chmod writes nothing.
      try {
        await chmod(path, 0o600)
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      }
      await appendFile(path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
    },
    async read(): Promise<ApprovalRecord[]> {
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw cause
      }
      const records: ApprovalRecord[] = []
      const lines = text.split('\n')
      for (const [i, line] of lines.entries()) {
        if (line.trim() === '') continue
        try {
          records.push(JSON.parse(line) as ApprovalRecord)
        } catch (cause) {
          throw new Error(`approval ledger ${path} has a damaged line ${i + 1}`, { cause })
        }
      }
      return records
    },
  }
}
