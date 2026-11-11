import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Writable } from 'node:stream'
import { gzipSync } from 'node:zlib'

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

/** A minimal ustar archive of regular files (names under 100 bytes). */
function tar(files: ReadonlyArray<{ name: string; content: string }>): Buffer {
  const blocks: Buffer[] = []
  for (const file of files) {
    const body = Buffer.from(file.content, 'utf8')
    const header = Buffer.alloc(512)
    header.write(file.name, 0, 100, 'utf8')
    header.write('0000644\0', 100)
    header.write('0000000\0', 108)
    header.write('0000000\0', 116)
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124)
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136)
    header.write('        ', 148)
    header.write('0', 156)
    header.write('ustar\0' + '00', 257)
    const sum = header.reduce((total, byte) => total + byte, 0)
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return Buffer.concat(blocks)
}

function parseTriage(args: readonly string[]): string | undefined {
  if (args.length === 0) return undefined
  const out = args[1]
  if (args.length === 2 && args[0] === '--out' && out !== undefined && !out.startsWith('-')) return out
  throw new UsageError('theoclaw triage: expected [--out <dir>]')
}

export function triageCommand(args: readonly string[], io: TriageIo): Promise<number> {
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
  const archive = gzipSync(tar(files))
  // The names stay in the clear; no configured value may appear in what is written.
  const written = [...files.map((file) => file.content), promptText, archive.toString('latin1'), tar(files).toString('utf8')]
  if (secrets.some((secret) => written.some((text) => text.includes(secret)))) {
    io.stderr.write('theoclaw triage: a secret value survived masking; nothing was written\n')
    return Promise.resolve(1)
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, archiveName), archive, { mode: 0o600 })
  writeFileSync(join(outDir, promptName), promptText, { mode: 0o600 })
  io.stdout.write(`${JSON.stringify({ promptPath: join(outDir, promptName), bundlePath: join(outDir, archiveName), findings: findings.length })}\n`)
  return Promise.resolve(0)
}
