import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

/** Test stand-in for taskkill /T /F: the whole process group on POSIX, the single pid elsewhere. */
function killNow(pid: number): void {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 'SIGKILL')
  } catch {
    // already gone
  }
}

function freePort(): Promise<number> {
  return new Promise((resolvePort) => {
    const srv = createTcp()
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => {
        resolvePort(port)
      })
    })
  })
}

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
  /** A foreign server answering 200 (without the ready token) on a port of its own. */
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
  const killTree = async (pid: number): Promise<number> => {
    killNow(pid)
    return 0
  }

  // The child stays alive on a port other than the checked one, where a foreign 200 server sits:
  // only the ready-token check can tell the two apart.
  it.each(['darwin', 'win32'] as const)(
    'rejects a live child on a substituted port behind a foreign 200 on %s',
    async (platform) => {
      const taken = await occupy200()
      const err = await startTestServer({
        cwd: app,
        platform,
        pickPort: async () => taken,
        childPort: () => taken + 1,
        killTree,
      }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(TestServerBootError)
      expect((err as Error).message).toMatch(/answered by another server/)
    },
    120_000,
  )

  it.each(['darwin', 'win32'] as const)(
    'retries on another port after a foreign 200 on %s',
    async (platform) => {
      const taken = await occupy200()
      const good = await freePort()
      const ports = [taken, good]
      const server = await startTestServer({
        cwd: app,
        platform,
        pickPort: async () => ports.shift() ?? good,
        childPort: (p) => (p === taken ? good : p),
        killTree,
      })
      expect(server.origin).toBe(`http://localhost:${String(good)}`)
      await server.close()
    },
    120_000,
  )

  describe('Windows process tree', () => {
    const treeApp = (name: string, pidFile: string): string =>
      writeApp(
        name,
        `import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const d = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
writeFileSync(${JSON.stringify(pidFile)}, String(d.pid))
export default {}
`,
      )
    const waitDead = async (pid: number): Promise<void> => {
      const until = Date.now() + 5000
      while (alive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
    }

    it('kills a descendant recorded while the leader lived, even after the leader exited', async () => {
      const pidFile = join(ROOT, 'descendant.pid')
      const tree = treeApp('tree', pidFile)
      const killed: number[] = []
      const server = await startTestServer({
        cwd: tree,
        platform: 'win32',
        listDescendants: async () =>
          existsSync(pidFile) ? [Number(readFileSync(pidFile, 'utf8'))] : [],
        // Single-pid kill only: the descendant dies only if it was tracked.
        killTree: async (pid) => {
          killed.push(pid)
          try {
            process.kill(pid, 'SIGKILL')
          } catch {
            // already gone
          }
          return 0
        },
      })
      const descendant = Number(readFileSync(pidFile, 'utf8'))
      expect(alive(descendant)).toBe(true)
      // The leader dies first: the descendant is orphaned and no longer reachable from it.
      process.kill(server.pid ?? 0, 'SIGKILL')
      await waitDead(server.pid ?? 0)
      await server.close()
      expect(killed).toContain(descendant)
      expect(alive(descendant)).toBe(false)
    }, 120_000)

    it('fails close() when a tracked process survives termination', async () => {
      const pidFile = join(ROOT, 'descendant2.pid')
      const tree = treeApp('tree2', pidFile)
      const server = await startTestServer({
        cwd: tree,
        platform: 'win32',
        listDescendants: async () =>
          existsSync(pidFile) ? [Number(readFileSync(pidFile, 'utf8'))] : [],
        killTree: async () => 0, // claims success, kills nothing
      })
      const descendant = Number(readFileSync(pidFile, 'utf8'))
      await expect(server.close()).rejects.toThrow(/still running/)
      killNow(server.pid ?? 0)
      process.kill(descendant, 'SIGKILL')
    }, 120_000)

    it('surfaces a failed termination', async () => {
      const stuck = await startTestServer({ cwd: app, platform: 'win32', killTree: async () => 1 })
      await expect(stuck.close()).rejects.toThrow(/could not terminate/)
      killNow(stuck.pid ?? 0)
    }, 120_000)
  })
})
