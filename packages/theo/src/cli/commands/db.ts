import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { loadConfig } from '../../config/load-config.js'
import { storageSchema } from '../../config/schema.js'

type DbAction = 'migrate' | 'push' | 'generate' | 'seed' | 'studio' | 'check' | 'reset'

const VALID_ACTIONS = new Set<DbAction>([
  'migrate',
  'push',
  'generate',
  'seed',
  'studio',
  'check',
  'reset',
])

export interface DbCommandOptions {
  force?: boolean
  host?: string
  port?: number
}

interface DbCommandResult {
  status: 'success' | 'error' | 'invalid_action'
  message: string
  action?: DbAction
}

type DbTool = 'drizzle-kit' | 'tsx'

/**
 * Runs one of the project's own tools, without a shell: the tool name and its argv, so a path with a
 * space or a quote is never parsed. Injected so a test can see the command without running it.
 */
type RunCommand = (tool: DbTool, args: readonly string[], cwd: string) => void

/**
 * The JS entry of a tool installed in the project, read from its package.json `bin`. Running it with
 * `process.execPath` needs neither a shell nor `npx`/`.cmd` shims, which Node refuses to spawn
 * without a shell on Windows (CVE-2024-27980).
 */
export function resolveToolBin(cwd: string, tool: DbTool): string {
  const req = createRequire(join(cwd, 'package.json'))
  let pkgPath: string
  try {
    pkgPath = req.resolve(`${tool}/package.json`)
  } catch {
    throw new Error(`${tool} not found. Run: npm install -D ${tool}`)
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin?: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[tool]
  if (rel === undefined) throw new Error(`${tool} has no "${tool}" bin in its package.json`)
  return resolve(dirname(pkgPath), rel)
}

const runInherited: RunCommand = (tool, args, cwd) => {
  execFileSync(process.execPath, [resolveToolBin(cwd, tool), ...args], { cwd, stdio: 'inherit' })
}

function assertFileExists(cwd: string, relPath: string, hint: string): void {
  if (!existsSync(resolve(cwd, relPath))) {
    throw new Error(`${relPath} not found. ${hint}`)
  }
}

function assertBinExists(cwd: string, bin: string): void {
  const binPath = resolve(cwd, 'node_modules', '.bin', bin)
  if (!existsSync(binPath)) {
    throw new Error(`${bin} not found. Run: npm install -D ${bin}`)
  }
}

/**
 * Each verb runs the drizzle-kit command of the same name.
 *
 * `migrate` used to run `drizzle-kit push` (usetheokit/theokit#1021). Push diffs the schema straight
 * into the database: it never reads the files `generate` writes and keeps no
 * `drizzle.__drizzle_migrations` journal, so a deploy script calling `theokit db migrate` applied
 * an unreviewed diff with no record of it. `migrate` now applies the generated files, and the old
 * behaviour stays available, under its real name, as `push`.
 */
const DRIZZLE_KIT = 'drizzle-kit' as const

const DRIZZLE_KIT_VERBS = {
  migrate: { args: [DRIZZLE_KIT, 'migrate'], message: 'Migrations applied' },
  push: { args: [DRIZZLE_KIT, 'push'], message: 'Schema pushed to the database' },
  generate: { args: [DRIZZLE_KIT, 'generate'], message: 'Migration files generated' },
  studio: { args: [DRIZZLE_KIT, 'studio'], message: 'Studio stopped' },
  check: { args: [DRIZZLE_KIT, 'check'], message: 'Migrations are consistent' },
} as const

async function runProjectScript(
  name: 'seed' | 'reset',
  cwd: string,
  run: RunCommand,
  hint: string,
): Promise<void> {
  // The script lives under the configured `serverDir`; a hardcoded `server/` missed the
  // scaffold's `src/server` layout.
  const { serverDir, storage } = await loadConfig(cwd)
  const seedPath = join(serverDir, 'db', `${name}.ts`)
  assertFileExists(cwd, seedPath, `Create ${seedPath} ${hint}`)
  console.log(`\n  ▸ Running ${name}...\n`)
  // #1439 — the seed is a bare child process, so `config.storage` never reached its storage manager
  // and any seed importing a `usePostgres('main', ...)` module threw "Database not configured".
  // A preload applies the parsed storage config through the project's own `theokit` instance.
  const preloadDir = resolve(cwd, 'node_modules', '.cache', 'theokit')
  const preload = join(preloadDir, 'seed-preload.mjs')
  const hasStorage = storage !== undefined
  if (hasStorage) {
    mkdirSync(preloadDir, { recursive: true })
    const parsed = JSON.stringify(storageSchema.parse(storage))
    writeFileSync(
      preload,
      `import { getStorageManager } from 'theokit/server/storage'\ngetStorageManager().configure(${parsed})\n`,
    )
  }
  try {
    run('tsx', hasStorage ? ['--import', preload, seedPath] : [seedPath], cwd)
  } finally {
    if (hasStorage) rmSync(preload, { force: true })
  }
}

export async function dbCommand(
  action: string,
  cwd: string,
  run: RunCommand = runInherited,
  options: DbCommandOptions = {},
): Promise<DbCommandResult> {
  if (!VALID_ACTIONS.has(action as DbAction)) {
    return {
      status: 'invalid_action',
      message: `Unknown db action "${action}". Available: ${[...VALID_ACTIONS].join(', ')}`,
    }
  }

  const dbAction = action as DbAction

  try {
    if (dbAction === 'seed') {
      await runProjectScript('seed', cwd, run, 'with your seed data.')
      return { status: 'success', message: 'Database seeded successfully', action: dbAction }
    }
    if (dbAction === 'reset') {
      if (options.force !== true) {
        throw new Error(
          'db reset is destructive: it runs your db/reset.ts against the database. Re-run with --force to confirm.',
        )
      }
      await runProjectScript('reset', cwd, run, 'with the code that resets your database.')
      return { status: 'success', message: 'Database reset', action: dbAction }
    }
    const verb = DRIZZLE_KIT_VERBS[dbAction]
    assertFileExists(cwd, 'drizzle.config.ts', 'Create a drizzle.config.ts for your project.')
    assertBinExists(cwd, DRIZZLE_KIT)
    console.log(`\n  ▸ Running ${verb.args.join(' ')}...\n`)
    const extra: string[] = []
    if (dbAction === 'studio') {
      if (options.host !== undefined) extra.push('--host', options.host)
      if (options.port !== undefined) extra.push('--port', String(options.port))
    }
    run(DRIZZLE_KIT, [...verb.args.slice(1), ...extra], cwd)
    return { status: 'success', message: verb.message, action: dbAction }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'error', message: msg, action: dbAction }
  }
}

export async function dbCommandCli(action: string, options: DbCommandOptions = {}): Promise<void> {
  const result = await dbCommand(action, process.cwd(), undefined, options)
  if (result.status === 'success') {
    console.log(`\n  ✓ ${result.message}\n`)
  } else {
    console.error(`\n  ✗ ${result.message}\n`)
    process.exit(1)
  }
}
