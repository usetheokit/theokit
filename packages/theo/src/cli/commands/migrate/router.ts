/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time codemod: derives all FS paths from the user's `<routesDir>`
 * argument (defaults to `<cwd>/server/routes`). No HTTP input reaches
 * these fs calls. Operator runs this manually via `theokit migrate router`.
 */
/**
 * G6 T2.1 — `theokit migrate router` CLI subcommand.
 *
 * Plan: .claude/knowledge-base/plans/g6-router-convention-plan.md v1.1
 *
 * Wraps the pure `planRouterMigration` with side effects:
 *   - EC-2: pre-flight `isPortInUse(3000|3100)` warning to prevent the
 *     dev-server HMR cascade described in the edge-case review.
 *   - EC-7: partial failure produces a typed `RouterMigrationPartialFailure`
 *     with `filesAlreadyMigrated` so a re-run can continue from where it
 *     stopped (idempotent by virtue of `planRouterMigration`).
 *   - Prefers `git mv $from $to` so the rename appears as a single
 *     history entry; falls back to `mkdir -p $(dirname $to) && fs.rename`
 *     when not in a git repo or git mv fails.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'

import {
  computeDepthDelta,
  planRouterMigration,
  rewriteRelativeImports,
  type RouterMigrationPlanItem,
} from './router-codemod.js'

export interface RouterMigrateOptions {
  /** Absolute path to `<project>/server/routes`. Defaults to `<cwd>/server/routes`. */
  routesDir?: string
  /**
   * Skip the EC-2 dev-server port pre-flight check (CI / non-TTY).
   * Default: false.
   */
  force?: boolean
  /** When true, prints the plan but performs no renames (dry-run). */
  dryRun?: boolean
  /** When true, suppresses stdout (used in tests). */
  silent?: boolean
}

/**
 * Thrown when the codemod completes with at least one successful rename
 * AND at least one failure — caller can re-run safely (idempotent) and
 * the second pass will skip already-migrated files.
 */
export class RouterMigrationPartialFailure extends Error {
  override readonly name = 'RouterMigrationPartialFailure'
  readonly filesAlreadyMigrated: string[]
  readonly failedFile: string
  readonly causeMessage: string
  constructor(filesAlreadyMigrated: string[], failedFile: string, causeMessage: string) {
    super(
      `Router migration partial failure: ${filesAlreadyMigrated.length} files migrated successfully, then failed on ${failedFile}: ${causeMessage}. Re-run \`theokit migrate router\` to retry — already-migrated files will be skipped.`,
    )
    this.filesAlreadyMigrated = filesAlreadyMigrated
    this.failedFile = failedFile
    this.causeMessage = causeMessage
  }
}

/**
 * EC-2: dev-server detection. Returns true if the port is in use (someone
 * is already listening on localhost:<port>). Uses Node's `node:net` —
 * zero new deps.
 */
export async function isPortInUse(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const probe = createServer()
    probe.once('error', (err: NodeJS.ErrnoException) => {
      probe.close(() => {
        resolve(err.code === 'EADDRINUSE')
      })
    })
    probe.once('listening', () => {
      probe.close(() => {
        resolve(false)
      })
    })
    probe.listen(port, '127.0.0.1')
  })
}

/**
 * EC-2 pre-flight: returns the first port in use among the typical
 * theokit dev ports (3000 + 3100) so the caller can warn the user.
 */
export async function findRunningDevServerPort(): Promise<number | null> {
  for (const port of [3000, 3100]) {
    if (await isPortInUse(port)) return port
  }
  return null
}

function tryGitMv(from: string, to: string): boolean {
  try {
    mkdirSync(dirname(to), { recursive: true })
    // Arguments are absolute paths from a recursive walk of <routesDir>.
    // Pass as argv to avoid shell parsing entirely (no `shell: true`).
    // `git` is resolved via the operator's PATH (same security model as
    // every other CLI tool — `theokit dev`, `pnpm install`, etc.).
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execFileSync('git', ['mv', from, to], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function fallbackRename(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  renameSync(from, to)
}

function applyRename(item: RouterMigrationPlanItem): void {
  if (!existsSync(item.from)) {
    // Idempotency: already migrated — skip silently
    return
  }
  if (existsSync(item.to)) {
    // The plan() phase would have thrown CollisionError if we knew about
    // it at plan time. This branch covers a race condition where the
    // target was created between plan and apply.
    throw new Error(
      `Refusing to overwrite existing file at ${item.to} during migration of ${item.from}`,
    )
  }
  if (!tryGitMv(item.from, item.to)) {
    fallbackRename(item.from, item.to)
  }
}

/**
 * Adjust relative imports inside the renamed file to compensate for the
 * extra nesting depth. Without this, `import { foo } from './chat'` inside
 * a file moved from `routes/admin.sdk-config.ts` → `routes/admin/sdk-config.ts`
 * would fail to resolve at typecheck/runtime — the import needs `../chat`
 * now that the file lives one level deeper.
 */
function applyImportRewrite(item: RouterMigrationPlanItem, routesDir: string): void {
  const delta = computeDepthDelta(item.from, item.to, routesDir)
  if (delta <= 0) return
  const source = readFileSync(item.to, 'utf8')
  const rewritten = rewriteRelativeImports(source, delta)
  if (rewritten !== source) {
    writeFileSync(item.to, rewritten, 'utf8')
  }
}

export interface RouterMigrateResult {
  /** Successfully renamed (from, to) pairs. */
  migrated: RouterMigrationPlanItem[]
  /** Plan was empty — nothing to do (already-nested). */
  alreadyClean: boolean
}

type LogFn = (msg: string) => void

function makeLog(silent: boolean | undefined): LogFn {
  if (silent) {
    return (_msg: string) => {
      // intentionally silent
    }
  }
  return (msg: string) => {
    console.log(msg)
  }
}

async function assertNoRunningDevServer(opts: RouterMigrateOptions): Promise<void> {
  if (opts.force) return
  const runningPort = await findRunningDevServerPort()
  if (runningPort !== null) {
    throw new Error(
      `Detected theokit dev server running on port ${runningPort}. STOP it before running migration to avoid HMR cascade (see EC-2). Re-run with --force to override.`,
    )
  }
}

function executeRenames(
  plan: readonly RouterMigrationPlanItem[],
  routesDir: string,
  log: LogFn,
): RouterMigrationPlanItem[] {
  const migrated: RouterMigrationPlanItem[] = []
  for (const item of plan) {
    try {
      applyRename(item)
      applyImportRewrite(item, routesDir)
      migrated.push(item)
      log(`     ✓ ${item.from} → ${item.to}`)
    } catch (err) {
      // EC-7: partial failure observability — emit structured error with
      // the list of already-migrated files so a re-run can recover.
      const causeMessage = err instanceof Error ? err.message : String(err)
      throw new RouterMigrationPartialFailure(
        migrated.map((m) => m.from),
        item.from,
        causeMessage,
      )
    }
  }
  return migrated
}

export async function routerMigrateCommand(
  opts: RouterMigrateOptions = {},
): Promise<RouterMigrateResult> {
  const routesDir = opts.routesDir ?? resolve(process.cwd(), 'server', 'routes')
  const log = makeLog(opts.silent)

  await assertNoRunningDevServer(opts)

  const plan = planRouterMigration(routesDir)
  if (plan.length === 0) {
    log('  ✓ Router already uses directory-nested convention. Nothing to do.')
    return { migrated: [], alreadyClean: true }
  }

  log(`  → Migrating ${plan.length} dotted route(s) to directory-nested form...`)

  if (opts.dryRun) {
    for (const item of plan) {
      log(`     [dry-run] ${item.from} → ${item.to}`)
    }
    return { migrated: [], alreadyClean: false }
  }

  const migrated = executeRenames(plan, routesDir, log)
  log(`  ✓ Migrated ${migrated.length} route(s).`)
  return { migrated, alreadyClean: false }
}
