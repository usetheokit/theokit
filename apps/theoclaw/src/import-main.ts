import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { describeError, TheoClawConfigError } from './control-plane/errors.js'
import { applyInstance, resolveInstance } from './instance.js'
import { readClaudeCodeSetup } from './migration/claude-code-source.js'
import type { ForeignSetup } from './migration/foreign-setup.js'
import { readHermesSetup } from './migration/hermes-source.js'
import { writeImport } from './migration/import-store.js'

/**
 * The import entry (FR-006, FR-007): `node dist/import-main.js --from claude-code|hermes`
 * (`pnpm --filter theoclaw run import`). The instance is resolved and applied as `src/main.ts` does
 * it, so a profiled instance's import lands in its own state directory (B-514); then a reader
 * copies the source and `writeImport` validates and replaces `<THEOCLAW_STATE_DIR>/import`. Every
 * failure is one `TheoClawConfigError` line and exit 1; nothing printed carries an MCP value.
 * Nothing imports this file.
 */

interface ImportArgs {
  readonly from: ForeignSetup['kind']
  readonly source?: string
  readonly project?: string
  readonly home?: string
}

const KINDS: ReadonlyArray<ForeignSetup['kind']> = ['claude-code', 'hermes']

function parseImportArgs(argv: string[]): ImportArgs {
  let values: Record<string, string | undefined>
  try {
    values = parseArgs({
      args: argv,
      options: { from: { type: 'string' }, source: { type: 'string' }, project: { type: 'string' }, home: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (error) {
    throw new TheoClawConfigError(describeError(error))
  }
  const from = values.from
  if (from === undefined || !KINDS.includes(from as ForeignSetup['kind'])) {
    throw new TheoClawConfigError('--from must be claude-code or hermes')
  }
  if (from === 'hermes' && (values.project !== undefined || values.home !== undefined)) {
    throw new TheoClawConfigError('--project and --home are read only with --from claude-code')
  }
  // Resolved against the working directory before any reader runs (EC-3).
  const absolute = (path: string | undefined): string | undefined => (path === undefined ? undefined : resolve(path))
  return { from: from as ForeignSetup['kind'], source: absolute(values.source), project: absolute(values.project), home: absolute(values.home) }
}

function requireDirectory(path: string, flag: string): string {
  let isDirectory = false
  try {
    isDirectory = statSync(path).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (!isDirectory) throw new TheoClawConfigError(`${flag}: ${path} is not a directory`)
  return path
}

function requireStateDir(env: NodeJS.ProcessEnv): string {
  const stateDir = (env.THEOCLAW_STATE_DIR ?? '').trim()
  if (stateDir === '') {
    throw new TheoClawConfigError('THEOCLAW_STATE_DIR must name the directory the import is written to', { variable: 'THEOCLAW_STATE_DIR' })
  }
  return stateDir
}

function readSetup(args: ImportArgs, userHome: string): ForeignSetup {
  if (args.from === 'hermes') return readHermesSetup({ root: requireDirectory(args.source ?? join(userHome, '.hermes'), '--source') })
  const home = requireDirectory(args.home ?? userHome, '--home')
  return readClaudeCodeSetup({
    configDir: requireDirectory(args.source ?? join(home, '.claude'), '--source'),
    home,
    ...(args.project === undefined ? {} : { project: requireDirectory(args.project, '--project') }),
  })
}

function summary(setup: ForeignSetup, notes: readonly string[]): string[] {
  return [
    `imported ${setup.kind}: ${setup.instructions.length} instruction files`,
    `imported ${setup.kind}: ${setup.memories.length} memory files`,
    `imported ${setup.kind}: ${setup.skills.length} skills`,
    `imported ${setup.kind}: ${Object.keys(setup.mcpServers).length} MCP servers`,
    ...setup.dropped.map((entry) => `dropped ${entry.path}: ${entry.reason}`),
    ...notes.map((note) => `note: ${note}`),
  ]
}

try {
  // Parsed first, so a mistyped flag creates no profile directory.
  const args = parseImportArgs(process.argv.slice(2))
  const instance = resolveInstance(process.env, { homeDir: homedir() })
  applyInstance(instance, process.env)
  const stateDir = requireStateDir(process.env)
  const setup = readSetup(args, homedir())
  const { notes } = writeImport(stateDir, setup, { now: new Date() })
  process.stdout.write(`${summary(setup, notes).join('\n')}\n`)
  process.exitCode = 0
} catch (error) {
  process.stderr.write(`theoclaw import: ${describeError(error)}\n`)
  process.exitCode = 1
}
