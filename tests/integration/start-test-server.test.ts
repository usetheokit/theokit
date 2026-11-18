import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer as createHttp } from 'node:http'
import { createServer as createTcp, type Server } from 'node:net'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startTestServer, TestServerBootError } from '../../packages/theo/src/testing/index.js'

/**
 * `startTestServer` runs the app's own theokit CLI, so the fixtures link `node_modules/theokit` to the
 * workspace package (which needs `pnpm build`). Fixtures live under the repo so react and vite resolve.
 */
const REPO = resolve(__dirname, '../..')
const ROOT = resolve(__dirname, '..', '.tmp-start-test-server')

function writeApp(name: string, config: string): string {
  const app = join(ROOT, name)
  mkdirSync(join(app, 'app'), { recursive: true })
  mkdirSync(join(app, 'node_modules'), { recursive: true })
  symlinkSync(resolve(REPO, 'packages/theo'), join(app, 'node_modules', 'theokit'), 'dir')
  writeFileSync(join(app, 'package.json'), '{ "type": "module" }')
  writeFileSync(join(app, 'app', 'page.tsx'), 'export default function Page() { return null }\n')
  writeFileSync(join(app, 'theo.config.ts'), config)
  return app
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('startTestServer', () => {
  let ok: string
  let broken: string
  beforeAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
    ok = writeApp('ok', 'export default {}\n')
    broken = writeApp('broken', "throw new Error('config-exploded')\n")
  })
  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('serves, then close() frees the port and leaves no process behind', async () => {
    const server = await startTestServer({ cwd: ok, mode: 'dev' })
    expect((await fetch(`${server.origin}/__theo/health`)).status).toBe(200)
    const pid = server.pid ?? 0
    await server.close()
    await server.close()
    await expect(fetch(`${server.origin}/__theo/health`)).rejects.toThrow()
    expect(pid).toBeGreaterThan(0)
    expect(alive(pid)).toBe(false)
    if (process.platform !== 'win32') expect(alive(-pid)).toBe(false)
  }, 90_000)

  it('rejects with the child output when the config throws', async () => {
    const err = await startTestServer({ cwd: broken, timeoutMs: 60_000 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TestServerBootError)
    expect((err as Error).message).toContain('config-exploded')
  }, 90_000)

  it('gives parallel servers different origins', async () => {
    const [a, b] = await Promise.all([startTestServer({ cwd: ok }), startTestServer({ cwd: ok })])
    try {
      expect(a.origin).not.toBe(b.origin)
    } finally {
      await Promise.all([a.close(), b.close()])
    }
  }, 120_000)

  describe.skipIf(process.platform !== 'linux')('port substitution', () => {
    const open: Server[] = []
    afterAll(async () => {
      await Promise.all(open.map((s) => new Promise((r) => s.close(r))))
    })
    function occupy(kind: 'http404' | 'raw'): Promise<number> {
      const srv =
        kind === 'http404'
          ? createHttp((_req, res) => {
              res.statusCode = 404
              res.end()
            })
          : createTcp((sock) => sock.destroy())
      open.push(srv as Server)
      return new Promise((r) => {
        srv.listen(0, () => r((srv.address() as { port: number }).port))
      })
    }

    it.each(['http404', 'raw'] as const)(
      'retries on another port when an unrelated %s listener holds the first',
      async (kind) => {
        const taken = await occupy(kind)
        const ports = [taken]
        const server = await startTestServer({
          cwd: ok,
          pickPort: async () => {
            const next = ports.shift()
            if (next !== undefined) return next
            const probe = createTcp()
            return new Promise((r) => {
              probe.listen(0, () => {
                const { port } = probe.address() as { port: number }
                probe.close(() => r(port))
              })
            })
          },
        })
        try {
          expect(server.origin).not.toBe(`http://localhost:${String(taken)}`)
          expect((await fetch(`${server.origin}/__theo/health`)).status).toBe(200)
        } finally {
          await server.close()
        }
      },
      90_000,
    )

    it('reports exhaustion when every attempt finds the port taken', async () => {
      const taken = await occupy('http404')
      let picks = 0
      const err = await startTestServer({
        cwd: ok,
        pickPort: async () => {
          picks++
          return taken
        },
      }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(TestServerBootError)
      expect((err as Error).message).toContain('was taken by another process')
      expect(picks).toBe(3)
    }, 120_000)
  })
})

describe('startTestServer on platforms without /proc (simulated)', () => {
  let app: string
  const open: Server[] = []
  beforeAll(() => {
    app = writeApp('subst', 'export default {}\n')
  })
  afterAll(async () => {
    await Promise.all(open.map((s) => new Promise((r) => s.close(r))))
    rmSync(ROOT, { recursive: true, force: true })
  })
  function occupy200(): Promise<number> {
    const srv = createHttp((_req, res) => {
      res.statusCode = 200
      res.end('{"status":"ready"}')
    })
    open.push(srv as Server)
    return new Promise((r) => {
      srv.listen(0, () => r((srv.address() as { port: number }).port))
    })
  }

  it.each(['darwin', 'win32'] as const)(
    'rejects a foreign 200 listener on %s instead of accepting it',
    async (platform) => {
      const taken = await occupy200()
      const err = await startTestServer({
        cwd: app,
        platform,
        timeoutMs: 60_000,
        pickPort: async () => taken,
        killTree: async (pid) => {
          try {
            process.kill(-pid, 'SIGKILL')
          } catch {
            // gone
          }
          return 0
        },
      }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(TestServerBootError)
      expect((err as Error).message).toMatch(/taken by another process|answered by another server/)
    },
    120_000,
  )

  it('terminates the Windows process tree on close() and surfaces a failed termination', async () => {
    const killed: number[] = []
    const server = await startTestServer({
      cwd: app,
      platform: 'win32',
      killTree: async (pid) => {
        killed.push(pid)
        process.kill(-pid, 'SIGKILL')
        return 0
      },
    })
    const pid = server.pid ?? 0
    await server.close()
    await server.close()
    expect(killed).toEqual([pid])
    expect(alive(pid)).toBe(false)

    const stuck = await startTestServer({ cwd: app, platform: 'win32', killTree: async () => 1 })
    await expect(stuck.close()).rejects.toThrow(/could not terminate/)
    process.kill(-(stuck.pid ?? 0), 'SIGKILL')
  }, 120_000)
})
