import type { Writable } from 'node:stream'

import { UsageError } from '../cli-args.js'
import { loadConfiguration } from '../config-file.js'
import { resolveInstance } from '../instance.js'
import { readActivityLedger } from '../tools/exec-approval.js'

/**
 * `theoclaw audit [--run <id>]`: the decision receipts of the exec gate, one line each: when, the
 * run, the tool, the command, whether it ran and who decided. `--run` takes an id or a prefix of one.
 */
export interface AuditIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly stdout: Writable
  readonly stderr: Writable
}

const USAGE_TEXT = 'theoclaw audit: expected [--run <id>]'

export function auditCommand(args: readonly string[], io: AuditIo): number {
  let run: string | undefined
  if (args.length === 2 && args[0] === '--run' && !args[1]!.startsWith('-')) run = args[1]
  else if (args.length > 0) throw new UsageError(USAGE_TEXT)
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const stateDir = env.THEOCLAW_STATE_DIR?.trim() || resolveInstance(env, { homeDir: io.homeDir }).stateDirectory
  if (stateDir === undefined || stateDir === '') {
    io.stderr.write('theoclaw: THEOCLAW_STATE_DIR must be set to the directory TheoClaw keeps its activity ledger in\n')
    return 1
  }
  const records = readActivityLedger(stateDir).filter((entry) => run === undefined || entry.runId.startsWith(run))
  if (records.length === 0) {
    io.stderr.write(`theoclaw: no activity recorded${run === undefined ? '' : ` for run ${run}`}\n`)
    return 1
  }
  for (const entry of records) {
    const verdict = entry.allowed ? 'approved' : 'refused'
    io.stdout.write(`${entry.at} run=${entry.runId} ${entry.tool} ${verdict} by ${entry.decidedBy} (${entry.reason}): ${JSON.stringify(entry.command)}\n`)
  }
  return 0
}
