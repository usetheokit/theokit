import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { loadConfig } from '../../config/load-config.js'

type DbAction = 'migrate' | 'push' | 'generate' | 'seed'

const VALID_ACTIONS = new Set<DbAction>(['migrate', 'push', 'generate', 'seed'])

interface DbCommandResult {
  status: 'success' | 'error' | 'invalid_action'
  message: string
  action?: DbAction
}

/** Runs a shell command in the project. Injected so a test can see the command without running it. */
type RunCommand = (command: string, cwd: string) => void

const runInherited: RunCommand = (command, cwd) => {
  execSync(command, { cwd, stdio: 'inherit' })
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
const DRIZZLE_KIT_VERBS = {
  migrate: { command: 'npx drizzle-kit migrate', message: 'Migrations applied' },
  push: { command: 'npx drizzle-kit push', message: 'Schema pushed to the database' },
  generate: { command: 'npx drizzle-kit generate', message: 'Migration files generated' },
} as const

async function runSeed(cwd: string, run: RunCommand): Promise<string> {
  // The seed file lives under the configured `serverDir`; a hardcoded `server/` missed the
  // scaffold's `src/server` layout.
  const { serverDir } = await loadConfig(cwd)
  const seedPath = join(serverDir, 'db', 'seed.ts')
  assertFileExists(cwd, seedPath, `Create ${seedPath} with your seed data.`)
  console.log('\n  ▸ Running seed...\n')
  run(`npx tsx ${seedPath}`, cwd)
  return 'Database seeded successfully'
}

export async function dbCommand(
  action: string,
  cwd: string,
  run: RunCommand = runInherited,
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
      return { status: 'success', message: await runSeed(cwd, run), action: dbAction }
    }
    const verb = DRIZZLE_KIT_VERBS[dbAction]
    assertFileExists(cwd, 'drizzle.config.ts', 'Create a drizzle.config.ts for your project.')
    assertBinExists(cwd, 'drizzle-kit')
    console.log(`\n  ▸ Running ${verb.command.replace('npx ', '')}...\n`)
    run(verb.command, cwd)
    return { status: 'success', message: verb.message, action: dbAction }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'error', message: msg, action: dbAction }
  }
}

export async function dbCommandCli(action: string): Promise<void> {
  const result = await dbCommand(action, process.cwd())
  if (result.status === 'success') {
    console.log(`\n  ✓ ${result.message}\n`)
  } else {
    console.error(`\n  ✗ ${result.message}\n`)
    process.exit(1)
  }
}
