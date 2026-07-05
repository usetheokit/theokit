/**
 * T5a.1 AC#3 — CF Workers smoke test passa (real wrangler dev).
 *
 * Drives `wrangler dev` against `tests/fixtures/handler-web-standards/`
 * using Miniflare (the default backend in wrangler v3+; no Cloudflare
 * account required). Asserts that the same `executeWebRequest` that
 * runs under Node bundles cleanly for the CF Workers runtime and serves
 * real HTTP.
 *
 * This is the executable proof of the Phase 5a R3a invariant: source-
 * level `node:*` count = 0 outside the Category B Node-adapter
 * allowlist, AND that invariant translates into a runnable CF Workers
 * worker. The fixture deliberately omits `nodejs_compat` from
 * `wrangler.toml` — adding it would invalidate the proof.
 *
 * Honest scope: this test runs `wrangler dev` as a subprocess, waits
 * for it to bind a port, and curls two routes. If `wrangler` is missing
 * from PATH, the test SKIPS with an honest message (per Rule 3 — never
 * lie about test coverage). CI environments without wrangler installed
 * skip; environments with it run the full smoke.
 *
 * Per `docs/plans/theokit-arch-gaps-implementation-plan.md` v1.2
 * T5a.1 Acceptance Criteria #3.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/handler-web-standards')
const WORKER_FILE = join(FIXTURE_DIR, 'worker.ts')
const WRANGLER_TOML = join(FIXTURE_DIR, 'wrangler.toml')
const PORT = 8792 // dedicated port — avoid collision with manual smokes

// Prefer the workspace-local wrangler (installed via `pnpm add -Dw
// wrangler`) so the test runs identically across CI + every developer's
// machine regardless of which Node version they happen to be on. Fall
// back to PATH lookup only when the local install is absent.
const LOCAL_WRANGLER = join(process.cwd(), 'node_modules/.bin/wrangler')

function resolveWrangler(): string | undefined {
  if (existsSync(LOCAL_WRANGLER)) return LOCAL_WRANGLER
  const path = process.env.PATH ?? ''
  for (const dir of path.split(':')) {
    const candidate = join(dir, 'wrangler')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const WRANGLER_BIN = resolveWrangler()

// Opt-in gate (issue #78). `wrangler dev` needs the workerd runtime + network to
// bind a port; in any sandbox / minimal CI without that toolchain the spawn never
// binds and the `beforeAll` below would hit its 90s hook timeout — even though the
// `wrangler` BINARY is present (it ships as a devDep, so the binary guard alone is
// not enough). Cloudflare Workers is a future / opt-in compatibility surface —
// TheoCloud is the only end-to-end-validated deploy target (CLAUDE.md) — so this
// real smoke runs ONLY when explicitly opted in. Everywhere else it skips cleanly.
const E2E_WRANGLER_OPT_IN =
  process.env.THEOKIT_E2E_WRANGLER === '1' || process.env.THEOKIT_E2E_WRANGLER === 'true'

async function fetchWithRetry(url: string, attempts = 30, delayMs = 1000): Promise<Response> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url)
      return response
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw new Error(`fetch ${url} failed after ${attempts} attempts: ${String(lastError)}`)
}

describe('T5a.1 AC#3 — wrangler dev CF Workers smoke', () => {
  if (!E2E_WRANGLER_OPT_IN) {
    it.skip('SKIPPED — opt-in only: set THEOKIT_E2E_WRANGLER=1 to run the CF Workers smoke (needs a working `wrangler dev`/workerd toolchain; CF Workers is a future/opt-in target — TheoCloud is the validated one)', () => {
      expect(true).toBe(true)
    })
    return
  }
  if (WRANGLER_BIN === undefined) {
    it.skip('SKIPPED — wrangler not installed (install via pnpm add -Dw wrangler)', () => {
      expect(true).toBe(true)
    })
    return
  }

  let proc: ChildProcess | undefined

  beforeAll(async () => {
    expect(existsSync(WORKER_FILE)).toBe(true)
    expect(existsSync(WRANGLER_TOML)).toBe(true)

    proc = spawn(
      WRANGLER_BIN,
      [
        'dev',
        '--port',
        String(PORT),
        '--local',
        '--inspector-port',
        '0',
        '--config',
        WRANGLER_TOML,
        WORKER_FILE,
      ],
      {
        cwd: FIXTURE_DIR,
        env: { ...process.env, CI: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    // Wait for the server to bind by polling the health route.
    await fetchWithRetry(`http://127.0.0.1:${String(PORT)}/`)
  }, 90_000)

  afterAll(async () => {
    if (proc) {
      proc.kill('SIGTERM')
      // Give miniflare time to release the port for the next run.
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  })

  it('GET / returns 200 with native JSON envelope (executeWebRequest under Miniflare)', async () => {
    const response = await fetch(`http://127.0.0.1:${String(PORT)}/`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; message: string }
    expect(body.ok).toBe(true)
    expect(body.message).toBe('hello from web-standards handler')
  })

  it('POST / with JSON body returns 200 with greeting (Zod body validation under CF runtime)', async () => {
    const response = await fetch(`http://127.0.0.1:${String(PORT)}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'world' }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { greeting: string }
    expect(body.greeting).toBe('hello, world')
  })

  it('POST / with invalid body returns 400 (Zod rejection via executeWebRequest under CF runtime)', async () => {
    // Note: executeWebRequest's Web shape returns 400 (BAD_REQUEST) on
    // body validation failure — see web-handler.ts:175. The
    // IncomingMessage path returns 422; the contracts intentionally
    // differ to mirror Fastify's body-parse convention (web) vs
    // application-level validation convention (legacy).
    const response = await fetch(`http://127.0.0.1:${String(PORT)}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(response.status).toBe(400)
  })
})
