import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Writable } from 'node:stream'

import { redactSecrets } from '@theokit/gateway'

import { UsageError } from '../cli-args.js'
import { loadConfiguration } from '../config-file.js'
import { resolveInstance } from '../instance.js'

/**
 * The activity ledger (OC-133): one JSON line per decision on a command, kept in the state
 * directory, and `theoclaw audit --run <id>` to read a run's records back.
 */

const FILE_NAME = 'activity-ledger.jsonl'

export interface ExecReceipt {
  readonly time: string
  readonly runId: string
  readonly agentId?: string
  readonly tool: string
  readonly command: string
  readonly allowed: boolean
  /** Who decided: `person`, `reviewer`, `saved-approval`, `elevated`, or `none`. */
  readonly approver: string
  readonly reason: string
}

export interface ActivityLedger {
  record(receipt: ExecReceipt): void
}

/** Appends 0600 lines; the command is passed through the secret redaction first. A write failure never stops the run. */
export function createActivityLedger(dir: string): ActivityLedger {
  const path = join(dir, FILE_NAME)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return {
    record(receipt) {
      try {
        appendFileSync(path, `${JSON.stringify({ ...receipt, command: redactSecrets(receipt.command) })}\n`, { mode: 0o600 })
      } catch {
        // The ledger is a record, not a gate.
      }
    },
  }
}

export function readReceipts(dir: string): ExecReceipt[] {
  const path = join(dir, FILE_NAME)
  if (!existsSync(path)) return []
  const receipts: ExecReceipt[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      receipts.push(JSON.parse(line) as ExecReceipt)
    } catch {
      continue
    }
  }
  return receipts
}

export interface AuditIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly stdout: Writable
  readonly stderr: Writable
}

const USAGE_TEXT = 'theoclaw audit: expected [--run <id>]'

/** `theoclaw audit [--run <id>]`: the receipts of one run (an id prefix is enough), or all of them. */
export function auditCommand(args: readonly string[], io: AuditIo): number {
  let run: string | undefined
  if (args.length === 2 && args[0] === '--run' && !args[1]!.startsWith('-')) run = args[1]
  else if (args.length > 0) throw new UsageError(USAGE_TEXT)
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const dir = env.THEOCLAW_STATE_DIR?.trim() || resolveInstance(env, { homeDir: io.homeDir }).stateDirectory
  if (dir === undefined || dir === '') throw new UsageError('theoclaw audit: THEOCLAW_STATE_DIR must be set')
  const receipts = readReceipts(dir).filter((r) => run === undefined || r.runId === run || r.runId.startsWith(run))
  if (receipts.length === 0) {
    io.stderr.write(`theoclaw: no activity recorded${run === undefined ? '' : ` for run ${run}`}\n`)
    return 1
  }
  for (const r of receipts) {
    io.stdout.write(`${r.time} run ${r.runId} ${r.tool} ${r.allowed ? 'approved' : 'refused'} by ${r.approver} (${r.reason}): ${r.command}\n`)
  }
  return 0
}
