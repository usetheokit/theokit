import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export type DbAction = 'migrate' | 'generate' | 'seed'

const VALID_ACTIONS = new Set<DbAction>(['migrate', 'generate', 'seed'])

export interface DbCommandResult {
  status: 'success' | 'error' | 'invalid_action'
  message: string
  action?: DbAction
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

export function dbCommand(action: string, cwd: string): DbCommandResult {
  if (!VALID_ACTIONS.has(action as DbAction)) {
    return {
      status: 'invalid_action',
      message: `Unknown db action "${action}". Available: ${[...VALID_ACTIONS].join(', ')}`,
    }
  }

  const dbAction = action as DbAction

  try {
    switch (dbAction) {
      case 'migrate': {
        assertFileExists(cwd, 'drizzle.config.ts', 'Create a drizzle.config.ts for your project.')
        assertBinExists(cwd, 'drizzle-kit')
        console.log('\n  ▸ Running drizzle-kit push...\n')
        execSync('npx drizzle-kit push', { cwd, stdio: 'inherit' })
        return { status: 'success', message: 'Database migrated successfully', action: dbAction }
      }
      case 'generate': {
        assertFileExists(cwd, 'drizzle.config.ts', 'Create a drizzle.config.ts for your project.')
        assertBinExists(cwd, 'drizzle-kit')
        console.log('\n  ▸ Running drizzle-kit generate...\n')
        execSync('npx drizzle-kit generate', { cwd, stdio: 'inherit' })
        return {
          status: 'success',
          message: 'Migration files generated in drizzle/',
          action: dbAction,
        }
      }
      case 'seed': {
        assertFileExists(cwd, 'server/db/seed.ts', 'Create server/db/seed.ts with your seed data.')
        console.log('\n  ▸ Running seed...\n')
        execSync('npx tsx server/db/seed.ts', { cwd, stdio: 'inherit' })
        return { status: 'success', message: 'Database seeded successfully', action: dbAction }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'error', message: msg, action: dbAction }
  }
}

export function dbCommandCli(action: string): void {
  const result = dbCommand(action, process.cwd())
  if (result.status === 'success') {
    console.log(`\n  ✓ ${result.message}\n`)
  } else {
    console.error(`\n  ✗ ${result.message}\n`)
    process.exit(1)
  }
}
