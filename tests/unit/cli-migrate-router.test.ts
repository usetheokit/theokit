/**
 * G6 T2.1 — `theokit migrate router` CLI wrapper tests.
 *
 * Covers side effects on top of the pure `planRouterMigration`:
 *   - EC-2 pre-flight: refuses to run when port 3000 / 3100 in use,
 *     unless --force.
 *   - End-to-end rename loop: 2 dotted routes → both renamed; tree on
 *     disk matches the expected directory-nested form.
 *   - Dry-run: prints plan but does NOT touch the filesystem.
 *   - Idempotent re-run: second invocation reports already-clean.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  routerMigrateCommand,
  isPortInUse,
  findRunningDevServerPort,
} from '../../packages/theo/src/cli/commands/migrate/router.js'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:net'

let routesDir: string
let blockingServer: Server | null = null

beforeEach(() => {
  const base = join(
    tmpdir(),
    `theo-g6-cli-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  routesDir = join(base, 'server', 'routes')
  mkdirSync(routesDir, { recursive: true })
})

afterEach(async () => {
  rmSync(routesDir, { recursive: true, force: true })
  if (blockingServer !== null) {
    await new Promise<void>((resolveClose) => blockingServer!.close(() => resolveClose()))
    blockingServer = null
  }
})

function touch(relativePath: string, content = 'export const GET = { handler: () => ({}) }') {
  const full = join(routesDir, relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

describe('G6 T2.1 — routerMigrateCommand (CLI wrapper)', () => {
  it('test_already_clean_tree_reports_no_work: empty plan returns alreadyClean=true', async () => {
    touch('auth/[provider]/login.ts')
    touch('posts/[id].ts')
    const result = await routerMigrateCommand({ routesDir, force: true, silent: true })
    expect(result.alreadyClean).toBe(true)
    expect(result.migrated).toEqual([])
  })

  it('test_dotted_routes_renamed_end_to_end: 2 dotted files migrate, tree matches expected', async () => {
    touch('auth.[provider].login.ts', 'export const POST = { handler: () => ({}) }')
    touch('posts.[id].ts', 'export const GET = { handler: () => ({}) }')

    const result = await routerMigrateCommand({ routesDir, force: true, silent: true })
    expect(result.alreadyClean).toBe(false)
    expect(result.migrated).toHaveLength(2)

    // Originals gone
    expect(existsSync(join(routesDir, 'auth.[provider].login.ts'))).toBe(false)
    expect(existsSync(join(routesDir, 'posts.[id].ts'))).toBe(false)
    // New nested form present
    expect(existsSync(join(routesDir, 'auth', '[provider]', 'login.ts'))).toBe(true)
    expect(existsSync(join(routesDir, 'posts', '[id].ts'))).toBe(true)
    // Content preserved
    expect(readFileSync(join(routesDir, 'auth', '[provider]', 'login.ts'), 'utf8')).toContain(
      'POST',
    )
  })

  it('test_dry_run_does_not_touch_disk: plan printed but files untouched', async () => {
    touch('auth.[provider].login.ts')
    const result = await routerMigrateCommand({
      routesDir,
      force: true,
      silent: true,
      dryRun: true,
    })
    expect(result.alreadyClean).toBe(false)
    expect(result.migrated).toEqual([])
    // Original still in place
    expect(existsSync(join(routesDir, 'auth.[provider].login.ts'))).toBe(true)
    expect(existsSync(join(routesDir, 'auth', '[provider]', 'login.ts'))).toBe(false)
  })

  it('test_idempotent_rerun_reports_clean_second_pass', async () => {
    touch('posts.[id].ts')
    const first = await routerMigrateCommand({ routesDir, force: true, silent: true })
    expect(first.migrated).toHaveLength(1)

    const second = await routerMigrateCommand({ routesDir, force: true, silent: true })
    expect(second.alreadyClean).toBe(true)
    expect(second.migrated).toEqual([])
  })

  it('test_isPortInUse_returns_true_when_a_server_holds_the_port (EC-2 plumbing)', async () => {
    // Pick a high port to avoid collisions with anything real on the dev box
    const port = 39_487
    blockingServer = createServer()
    await new Promise<void>((resolveListen) =>
      blockingServer!.listen(port, '127.0.0.1', () => resolveListen()),
    )

    expect(await isPortInUse(port)).toBe(true)
    expect(await isPortInUse(port + 1)).toBe(false)
  })

  it('test_pre_flight_refuses_without_force_when_dev_port_in_use (EC-2 contract)', async () => {
    // EC-2 contract: when `findRunningDevServerPort()` reports a port in use,
    // `routerMigrateCommand({ force: false })` MUST reject with a message
    // that includes "Detected theokit dev server running on port".
    // We probe state first — if neither 3000 nor 3100 is bindable, we
    // exercise the rejection path; otherwise we exercise the --force escape.
    const runningPort = await findRunningDevServerPort()

    if (runningPort !== null) {
      // Some dev server (or test fixture) is on 3000/3100 in this sandbox —
      // assert the wrapper refuses without --force.
      touch('posts.[id].ts')
      await expect(routerMigrateCommand({ routesDir, silent: true })).rejects.toThrow(
        /Detected theokit dev server running on port/,
      )
    } else {
      // No dev server up — assert the --force escape hatch DOESN'T fire the
      // pre-flight (i.e., the command runs to completion).
      touch('posts.[id].ts')
      const result = await routerMigrateCommand({ routesDir, force: true, silent: true })
      expect(result.migrated).toHaveLength(1)
    }
  })
})
