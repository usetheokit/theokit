import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Writable } from 'node:stream'

import { UsageError } from '../cli-args.js'
import { loadConfiguration } from '../config-file.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { resolveInstance } from '../instance.js'
import { hookFingerprint, parseApprovedHooks } from './hook-approval.js'

/**
 * `theoclaw hooks list` (OC-87): one line per command hook in `<workspace>/.theokit/settings.json`,
 * `<event>\t<fingerprint>\tapproved|not approved`, the fingerprint being the one
 * `THEOCLAW_APPROVED_HOOKS` accepts. A hook's `timeout` is in seconds (the SDK multiplies it by 1000); with none it takes 30000 ms.
 */
export interface HooksIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly cwd: string
  readonly stdout: Writable
  readonly stderr: Writable
}

const DEFAULT_TIMEOUT_MS = 30_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hooksCommand(args: readonly string[], io: HooksIo): number {
  if (args.length !== 1 || args[0] !== 'list') throw new UsageError('theoclaw hooks: expected list')
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const approved = parseApprovedHooks(env)
  const workspace = env.THEOCLAW_WORKSPACE?.trim() || resolveInstance(env, { homeDir: io.homeDir }).workspace || io.cwd
  const file = join(workspace, '.theokit', 'settings.json')
  if (!existsSync(file)) {
    io.stderr.write(`theoclaw: no hooks: ${file} does not exist\n`)
    return 1
  }
  let settings: unknown
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new TheoClawConfigError(`${file} is not valid JSON`)
  }
  const lines: string[] = []
  const hooks = isRecord(settings) ? settings.hooks : undefined
  if (isRecord(hooks)) {
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue
      for (const group of groups as unknown[]) {
        const entries = isRecord(group) ? group.hooks : undefined
        if (!Array.isArray(entries)) continue
        for (const entry of entries as unknown[]) {
          if (!isRecord(entry) || entry.type !== 'command' || typeof entry.command !== 'string') continue
          const timeoutMs = typeof entry.timeout === 'number' && entry.timeout > 0 ? Math.round(entry.timeout * 1000) : DEFAULT_TIMEOUT_MS
          const fingerprint = hookFingerprint({ sourceEvent: event, command: entry.command, timeoutMs })
          lines.push(`${event}\t${fingerprint}\t${approved.has(fingerprint) ? 'approved' : 'not approved'}\n`)
        }
      }
    }
  }
  if (lines.length === 0) {
    io.stderr.write(`theoclaw: no hooks found in ${file}\n`)
    return 1
  }
  io.stdout.write(lines.join(''))
  return 0
}
