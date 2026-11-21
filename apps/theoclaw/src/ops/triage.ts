import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Writable } from 'node:stream'

import { DiagnosticBundleError, writeDiagnosticBundle } from '@theokit/agents/doctor'

import { loadConfiguration } from '../config-file.js'
import { UsageError } from '../cli-args.js'
import { auditConfiguration } from '../security-audit.js'
import { configuredSecrets, redactLog } from './logs.js'

/**
 * `theoclaw triage [--out <dir>]` (OC-132): writes a sanitized diagnostics archive (`.tar.gz`) and
 * a prompt for a coding agent. The archive holds the version facts, the names (never the values)
 * of the settings in force, the security audit's findings and the tail of the log file when one
 * is configured. Every text passes the secret mask, and the written files are checked against the
 * configured secret values before the command reports success.
 */

export interface TriageIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly cwd: string
  readonly stdout: Writable
  readonly stderr: Writable
}

const LOG_LINES = 200

function parseTriage(args: readonly string[]): string | undefined {
  if (args.length === 0) return undefined
  const out = args[1]
  if (args.length === 2 && args[0] === '--out' && out !== undefined && !out.startsWith('-')) return out
  throw new UsageError('theoclaw triage: expected [--out <dir>]')
}

export async function triageCommand(args: readonly string[], io: TriageIo): Promise<number> {
  const outDir = resolve(io.cwd, parseTriage(args) ?? '.')
  const env: NodeJS.ProcessEnv = { ...io.env }
  let loadError: string | undefined
  try {
    loadConfiguration(env, io.homeDir)
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error)
  }
  const secrets = configuredSecrets(env)
  const clean = (text: string): string => redactLog(text, secrets)

  let findings: Array<{ id: string; message: string }> = []
  try {
    findings = auditConfiguration(io.env, io.homeDir).map(({ id, message }) => ({ id, message }))
  } catch (error) {
    loadError ??= error instanceof Error ? error.message : String(error)
  }
  const logFile = env.THEOCLAW_LOG_FILE
  const logTail = logFile !== undefined && existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').slice(-LOG_LINES).join('\n') : ''

  const report = {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    node: process.version,
    configurationError: loadError ?? null,
    settingNames: Object.keys(env).filter((name) => name.startsWith('THEOCLAW_')).sort(),
    findings,
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archiveName = `theoclaw-diagnostics-${stamp}.tar.gz`
  const promptName = `theoclaw-triage-prompt-${stamp}.md`
  const prompt = [
    '# TheoClaw triage',
    '',
    `Diagnostics archive: ${archiveName} (sanitized: setting names only, secrets masked).`,
    '',
    'Read `report.json` and `log-tail.txt` from the archive, find the cause of the failure, and propose a fix.',
    'Do not ask for, print or store credential values.',
    '',
    '## Findings',
    ...(findings.length === 0 ? ['none'] : findings.map((finding) => `- ${finding.id}: ${finding.message}`)),
    ...(loadError === undefined ? [] : ['', `Configuration error: ${loadError}`]),
    '',
    '## Suggested commands',
    '- `theoclaw doctor`',
    '- `theoclaw security audit`',
    '- `theoclaw logs --lines 200`',
    '',
  ].join('\n')

  const files = [
    { name: 'report.json', content: clean(`${JSON.stringify(report, null, 2)}\n`) },
    { name: 'log-tail.txt', content: clean(logTail) },
  ]
  const promptText = clean(prompt)
  const refused = (): number => {
    io.stderr.write('theoclaw triage: a secret value survived masking; nothing was written\n')
    return 1
  }
  if (secrets.some((secret) => promptText.includes(secret))) return refused()
  mkdirSync(outDir, { recursive: true })
  try {
    await writeDiagnosticBundle({ out: join(outDir, archiveName), files, secrets })
  } catch (error) {
    if (error instanceof DiagnosticBundleError && error.reason === 'secret_survived') return refused()
    throw error
  }
  writeFileSync(join(outDir, promptName), promptText, { mode: 0o600 })
  io.stdout.write(`${JSON.stringify({ promptPath: join(outDir, promptName), bundlePath: join(outDir, archiveName), findings: findings.length })}\n`)
  return 0
}
