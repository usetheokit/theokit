/**
 * Scaffold-to-request E2E — validates the full TheoKit developer flow:
 *
 *   1. `create-theokit` scaffold produces a valid project structure
 *   2. Scaffolded app builds successfully (tsup → dist/app.js)
 *   3. Scaffolded app dev server boots and responds to HTTP requests
 *
 * Tests 2 and 3 run `pnpm install` from the npm registry (slow, ~60s).
 * Set CI_SKIP_E2E=1 to skip them in fast CI pipelines.
 *
 * Why real install and not symlinks:
 *   The default template uses parameter decorators (@Body, @Param, @Query)
 *   which require @swc/core at runtime. When @swc/core is symlinked from the
 *   monorepo, Node.js ESM resolution follows the real path and fails to find
 *   transitive deps. A real `pnpm install` solves this cleanly.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'

import { scaffold } from '../../packages/create-theokit/src/index.js'

const _REPO = resolve(__dirname, '../..')
const SLOW = !!process.env.CI_SKIP_E2E

/** Find a free TCP port by binding to 0 and releasing. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, () => {
      const addr = srv.address()
      if (!addr || typeof addr === 'string') {
        srv.close()
        reject(new Error('Could not determine port'))
        return
      }
      const port = addr.port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

/** Wait until a URL responds (or timeout). */
async function waitForServer(url: string, timeoutMs: number, intervalMs = 500): Promise<Response> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      return res
    } catch (err) {
      lastError = err
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
  throw new Error(
    `Server at ${url} did not respond within ${timeoutMs}ms. Last error: ${lastError}`,
  )
}

/**
 * Build a clean env for pnpm install — strip vitest/monorepo env vars
 * that cause pnpm to inherit workspace settings from the parent process.
 */
function cleanPnpmEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, val] of Object.entries(process.env)) {
    // Skip npm/pnpm config vars inherited from the monorepo vitest process
    if (key.startsWith('npm_') || key.startsWith('pnpm_')) continue
    // Skip vitest internal vars
    if (key.startsWith('VITEST') || key === 'TEST' || key === 'VITE_TEST_BUILD') continue
    env[key] = val
  }
  return env
}

/** Install dependencies in the scaffolded project via pnpm. */
async function installDeps(projectDir: string): Promise<void> {
  const result = await runCommand('pnpm', ['install', '--no-frozen-lockfile'], {
    cwd: projectDir,
    timeout: 120_000,
    env: cleanPnpmEnv(),
  })
  // pnpm 9+ exits 1 on ERR_PNPM_IGNORED_BUILDS (native deps with
  // unapproved build scripts). The packages ARE installed — this is
  // a warning, not a fatal error. Accept exit 1 when the output
  // contains the specific error code.
  const ignoredBuilds = result.stdout.includes('ERR_PNPM_IGNORED_BUILDS')
  if (result.exitCode !== 0 && !ignoredBuilds) {
    throw new Error(
      `pnpm install failed (exit ${result.exitCode}).\n` +
        `stdout: ${result.stdout.slice(-800)}\n` +
        `stderr: ${result.stderr.slice(-800)}`,
    )
  }
  // When builds were ignored, run pnpm rebuild for native deps (@swc/core)
  if (ignoredBuilds) {
    await runCommand('pnpm', ['rebuild'], {
      cwd: projectDir,
      timeout: 60_000,
      env: cleanPnpmEnv(),
    })
  }
}

describe('scaffold-to-request E2E', () => {
  let projectDir: string
  let devProcess: ChildProcess | undefined
  let installed = false

  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'theokit-s2r-'))
    scaffold(projectDir, 'test-app', 'default')
  })

  afterEach(() => {
    // Kill dev server if started
    if (devProcess?.pid && !devProcess.killed) {
      try {
        process.kill(-devProcess.pid, 'SIGTERM')
      } catch {
        try {
          devProcess.kill('SIGTERM')
        } catch {
          /* already dead */
        }
      }
      devProcess = undefined
    }
  })

  afterAll(() => {
    if (projectDir && existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  // -------------------------------------------------------
  // Test 1: Scaffold produces a valid project structure
  // -------------------------------------------------------
  it('scaffold creates a valid project with all expected files', () => {
    // Core app files
    expect(existsSync(join(projectDir, 'app/page.tsx'))).toBe(true)
    expect(existsSync(join(projectDir, 'app/layout.tsx'))).toBe(true)

    // Entry point
    expect(existsSync(join(projectDir, 'app.ts'))).toBe(true)

    // Server layer — controllers
    expect(existsSync(join(projectDir, 'server/controllers/tasks.controller.ts'))).toBe(true)

    // Server layer — agents
    expect(existsSync(join(projectDir, 'server/agents/assistant.agent.ts'))).toBe(true)

    // Server layer — barrel
    expect(existsSync(join(projectDir, 'server/index.ts'))).toBe(true)

    // Server layer — guards, interceptors, filters, middleware
    expect(existsSync(join(projectDir, 'server/guards/auth.guard.ts'))).toBe(true)
    expect(existsSync(join(projectDir, 'server/interceptors/timing.interceptor.ts'))).toBe(true)
    expect(existsSync(join(projectDir, 'server/filters/http-error.filter.ts'))).toBe(true)
    expect(existsSync(join(projectDir, 'server/middleware/logger.middleware.ts'))).toBe(true)

    // Server layer — store and toolboxes
    expect(existsSync(join(projectDir, 'server/store.ts'))).toBe(true)
    expect(existsSync(join(projectDir, 'server/toolboxes/task.tools.ts'))).toBe(true)

    // Config files
    expect(existsSync(join(projectDir, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(projectDir, 'package.json'))).toBe(true)
    expect(existsSync(join(projectDir, 'eslint.config.mjs'))).toBe(true)

    // Template-processed: .tmpl files removed, final files present
    expect(existsSync(join(projectDir, 'package.json.tmpl'))).toBe(false)
    expect(existsSync(join(projectDir, 'README.md.tmpl'))).toBe(false)
    expect(existsSync(join(projectDir, 'README.md'))).toBe(true)

    // _gitignore renamed to .gitignore
    expect(existsSync(join(projectDir, '.gitignore'))).toBe(true)
    expect(existsSync(join(projectDir, '_gitignore'))).toBe(false)

    // React SSR — no public/index.html, React components ARE the frontend
    expect(existsSync(join(projectDir, 'app/page.tsx'))).toBe(true)
    expect(existsSync(join(projectDir, 'app/layout.tsx'))).toBe(true)
  })

  it('scaffold writes valid package.json with correct name and deps', () => {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))

    // Name substitution applied
    expect(pkg.name).toBe('test-app')

    // No leftover template placeholders
    const raw = readFileSync(join(projectDir, 'package.json'), 'utf8')
    expect(raw).not.toContain('{{name}}')

    // Required deps present
    expect(pkg.dependencies['@theokit/http']).toBeDefined()
    expect(pkg.dependencies['@theokit/agents']).toBeDefined()
    expect(pkg.dependencies.react).toBeDefined()
    expect(pkg.dependencies['react-dom']).toBeDefined()
    expect(pkg.dependencies['reflect-metadata']).toBeDefined()
    expect(pkg.dependencies.zod).toBeDefined()

    // Dev deps present
    expect(pkg.devDependencies.typescript).toBeDefined()
    expect(pkg.devDependencies.tsup).toBeDefined()
    expect(pkg.devDependencies.tsx).toBeDefined()
    expect(pkg.devDependencies['@swc/core']).toBeDefined()

    // Scripts present
    expect(pkg.scripts.dev).toBeDefined()
    expect(pkg.scripts.build).toBeDefined()
    expect(pkg.scripts.start).toBeDefined()
  })

  it('scaffold writes valid tsconfig.json with decorator support', () => {
    const tsconfig = JSON.parse(readFileSync(join(projectDir, 'tsconfig.json'), 'utf8'))
    expect(tsconfig.compilerOptions.experimentalDecorators).toBe(true)
    expect(tsconfig.compilerOptions.emitDecoratorMetadata).toBe(true)
    expect(tsconfig.compilerOptions.strict).toBe(true)
  })

  it('scaffold app.ts imports from @theokit/http', () => {
    const appTs = readFileSync(join(projectDir, 'app.ts'), 'utf8')
    expect(appTs).toMatch(/@theokit\/http/)
    expect(appTs).toMatch(/TheoApp\.create/)
    expect(appTs).toMatch(/app\.listen/)
  })

  // -------------------------------------------------------
  // Test 2: Scaffold + install + build
  // -------------------------------------------------------
  it.skipIf(SLOW)(
    'scaffold and build — pnpm install + tsup produces dist/app.js',
    async () => {
      await installDeps(projectDir)
      installed = true

      // Build using tsup (the template's build script)
      const buildResult = await runCommand('pnpm', ['run', 'build'], {
        cwd: projectDir,
        timeout: 60_000,
      })

      if (buildResult.exitCode !== 0) {
        throw new Error(
          `tsup build failed (exit ${buildResult.exitCode}).\n` +
            `stdout: ${buildResult.stdout.slice(-500)}\n` +
            `stderr: ${buildResult.stderr.slice(-500)}`,
        )
      }

      expect(existsSync(join(projectDir, 'dist/app.js'))).toBe(true)
    },
    180_000,
  )

  // -------------------------------------------------------
  // Test 3: Scaffold + dev server responds to HTTP
  // -------------------------------------------------------
  it.skipIf(SLOW)(
    'scaffold dev server boots and responds to HTTP request',
    async () => {
      // Ensure deps installed (test 2 may have done this already)
      if (!installed) {
        await installDeps(projectDir)
        installed = true
      }

      const port = await getFreePort()

      // Patch app.ts to use the dynamic port instead of hardcoded 3000
      const appTs = readFileSync(join(projectDir, 'app.ts'), 'utf8')
      const patched = appTs.replace(/app\.listen\(\d+\)/, `app.listen(${port})`)
      writeFileSync(join(projectDir, 'app.ts'), patched)

      // Start dev server via tsx (the template's dev script, without --watch)
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- E2E test deliberately runs npx in scaffolded project
      devProcess = spawn('npx', ['tsx', 'app.ts'], {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: {
          ...process.env,
          NODE_ENV: 'development',
        },
      })

      // Collect stderr/stdout for diagnostics
      let stdout = ''
      let stderr = ''
      devProcess.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString()
      })
      devProcess.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString()
      })

      // Wait for the server to be ready, then fetch /api/tasks
      const url = `http://localhost:${port}/api/tasks`
      try {
        const response = await waitForServer(url, 30_000)
        expect(response.status).toBe(200)

        const tasks = (await response.json()) as unknown[]
        expect(Array.isArray(tasks)).toBe(true)
        // The default template seeds 4 tasks
        expect(tasks.length).toBeGreaterThan(0)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `Dev server failed to respond.\n` +
            `stdout: ${stdout.slice(-800)}\n` +
            `stderr: ${stderr.slice(-800)}\n` +
            `Original: ${msg}`,
        )
      }
    },
    180_000,
  )
})

// -----------------------------------------------------------
// Helper: run a command and collect exit code + output
// -----------------------------------------------------------
interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeout: number; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env ?? process.env,
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ exitCode: 1, stdout, stderr: stderr + '\n[TIMEOUT]' })
    }, opts.timeout)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
  })
}
