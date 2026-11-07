import { existsSync, mkdirSync, statSync } from 'node:fs'
import type { Writable } from 'node:stream'

import { UsageError } from './cli-args.js'
import { configurationPath, loadConfiguration } from './config-file.js'
import { auditConfiguration, fixFindings } from './security-audit.js'

/**
 * `theoclaw doctor [--fix]`: reports what is wrong with the instance and, with `--fix`, repairs only
 * what has one safe fix and needs no secret: the configuration file and TheoClaw's directory at the
 * wrong mode (the SA-001 and SA-002 findings of `security audit`) and a missing state directory.
 * It never reads a value into its output and never rewrites the configuration file's content.
 */

interface Problem {
  readonly id: string
  readonly message: string
  readonly fix: () => void
}

function stateDirectoryOf(env: NodeJS.ProcessEnv): string | undefined {
  const directory = (env.THEOCLAW_STATE_DIR ?? '').trim()
  return directory === '' ? undefined : directory
}

function problems(env: NodeJS.ProcessEnv, homeDir: string): Problem[] {
  const merged: NodeJS.ProcessEnv = { ...env }
  const path = loadConfiguration(merged, homeDir) ?? configurationPath(merged, homeDir)
  const found: Problem[] = auditConfiguration(env, homeDir)
    .filter((finding) => finding.fixable)
    .map((finding) => ({ id: finding.id, message: finding.message, fix: () => void fixFindings([finding], path) }))
  const state = stateDirectoryOf(merged)
  if (state !== undefined && !existsSync(state)) {
    found.push({ id: 'DR-001', message: `the state directory ${state} does not exist`, fix: () => void mkdirSync(state, { recursive: true, mode: 0o700 }) })
  } else if (state !== undefined && !statSync(state).isDirectory()) {
    // Not repairable: replacing a file could destroy data.
    found.push({ id: 'DR-002', message: `${state} is not a directory`, fix: () => undefined })
  }
  return found
}

/** Exit 0 when nothing is left to report, 3 when problems remain. */
export function doctorCommand(
  args: readonly string[],
  io: { readonly env: NodeJS.ProcessEnv; readonly homeDir: string; readonly stdout: Writable },
): Promise<number> {
  if (args.some((arg) => arg !== '--fix')) throw new UsageError('theoclaw doctor: expected [--fix]')
  const fixing = args.includes('--fix')
  let remaining = 0
  for (const problem of problems(io.env, io.homeDir)) {
    if (fixing && problem.id !== 'DR-002') {
      problem.fix()
      io.stdout.write(`fixed ${problem.id}: ${problem.message}\n`)
    } else {
      remaining += 1
      io.stdout.write(`${problem.id}${problem.id === 'DR-002' ? '' : ' (fixable with --fix)'}: ${problem.message}\n`)
    }
  }
  return Promise.resolve(remaining === 0 ? 0 : 3)
}
