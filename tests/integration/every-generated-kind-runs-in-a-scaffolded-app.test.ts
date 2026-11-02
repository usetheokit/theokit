import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'

import { emitControllerArtifacts } from '../../packages/theo/src/cli/commands/build/emit-controllers.js'
import { startDevServer } from '../../packages/theo/src/cli/commands/dev.js'
import { generate } from '../../packages/theo/src/cli/commands/generate.js'
import type { GenerateResult } from '../../packages/theo/src/cli/commands/generate-types.js'
import { importUserModule } from '../../packages/theo/src/config/import-user-module.js'
import { scanRoutes } from '../../packages/theo/src/router/scan.js'

/**
 * Every kind `theokit generate` writes runs what its template promises, in an app laid out the way
 * `create-theokit` scaffolds one.
 *
 * The discovery for the `generate schedule` fix found the defect class (a generator that writes a
 * file which never runs) in 12 other kinds and scoped them out: route, action, page, ws,
 * controller, agent, toolbox, workflow, eval, sandbox, memory and resource. Checking that a file
 * lands in the right directory is not enough; `generate ws` wrote a file that imported an export no
 * public entry point has, and `generate controller` wrote one that `theokit build` refused. So
 * each case here loads the generated file the way the framework does and exercises it: through
 * `theokit dev` for what is served, by calling what is composed.
 *
 * The app's `node_modules` holds only packages the scaffold's `package.json` declares (`theokit`,
 * `@theokit/agents`, `@theokit/sdk`, `zod`; `react` and `react-dom` resolve from the repository
 * root). `@theokit/http` is linked only after the controller is generated, because the scaffold
 * does not install it and the generator must say so.
 *
 * This layout cannot catch a missing `@swc/core`. The link points at `packages/http`, whose own
 * `node_modules` holds `@swc/core` as a dev dependency, so the controller transform finds it
 * although the app never declares it. In an npm-installed scaffold nothing provides it and
 * `theokit build` failed (#986). Nor can it catch a notice that keys on resolution: `@theokit/http`
 * is absent here, while npm hoists it into a real scaffold. The notice is pinned against that
 * layout in `tests/unit/the-controller-notice-names-what-package-json-lacks.test.ts`.
 *
 * The eval runs against a local OpenAI-compatible server through `OPENROUTER_API_BASE_URL`, so no
 * request leaves the machine. Reads `packages/theo/dist`, `packages/agents/dist` and
 * `packages/http/dist`: build them first.
 */
const REPO = resolve(__dirname, '../..')
const TEMPLATE = resolve(REPO, 'packages/create-theokit/templates/default')
// The project must sit under the repository so `react`, `react-dom` and `better-sqlite3` resolve
// from the root `node_modules`, as they would from the app's own. `.tmp/` is gitignored.
const TMP_ROOT = resolve(REPO, 'tests/.tmp')
const VITEST = join(REPO, 'node_modules', '.bin', 'vitest')
const agentsRequire = createRequire(resolve(REPO, 'packages/agents/package.json'))

/** The package directory `require` resolves `name` to. */
function packageDir(require: NodeJS.Require, name: string): string {
  return dirname(require.resolve(`${name}/package.json`))
}

// `drizzle-orm` reaches the workspace only through `db0`, and neither exports `./package.json`, so
// the directory is the sibling pnpm links next to `db0`.
const drizzleDir = join(dirname(realpathSync(join(REPO, 'node_modules/db0'))), 'drizzle-orm')

/**
 * A SQLite `db` export with the table the generated `posts` resource reads and writes. A file, not
 * `:memory:`: each `importUserModule` call evaluates its own module graph, so the two route files
 * would otherwise each open a database of their own.
 */
const DB_INDEX = `import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

const sqlite = new Database(new URL('../../../app.db', import.meta.url).pathname)
sqlite.exec(
  'CREATE TABLE IF NOT EXISTS posts (id integer PRIMARY KEY AUTOINCREMENT, title text NOT NULL, created_at text NOT NULL)',
)
export const db = drizzle(sqlite)
`

let dir: string
let server: Awaited<ReturnType<typeof startDevServer>>
let origin: string
let controllerResult: GenerateResult

/** A built route method, as `route().build()` returns it. */
interface BuiltRoute {
  policy: (input: unknown) => unknown
  handler: (input: Record<string, unknown>) => unknown
}

/** A built tool, as `tool().build()` returns it. */
interface BuiltTool {
  name: string
  handler: (input: Record<string, unknown>, ctx?: unknown) => unknown
}

async function load(relativePath: string): Promise<Record<string, unknown>> {
  return importUserModule(join(dir, relativePath))
}

async function generated(kind: string, name: string, fields?: string[]): Promise<GenerateResult> {
  const result = await generate({ cwd: dir, type: kind, name, fields })
  expect(result, `generate ${kind} ${name}`).toMatchObject({ status: 'created' })
  return result
}

/** The JSON error message `theokit dev` answers a refused request with. */
async function refusal(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { message?: string } }
  return body.error?.message ?? ''
}

beforeAll(async () => {
  mkdirSync(TMP_ROOT, { recursive: true })
  dir = mkdtempSync(join(TMP_ROOT, 'generated-kinds-'))
  copyFileSync(join(TEMPLATE, 'theo.config.ts'), join(dir, 'theo.config.ts'))
  copyFileSync(join(TEMPLATE, 'index.html'), join(dir, 'index.html'))
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')
  mkdirSync(join(dir, 'src/app'), { recursive: true })
  writeFileSync(
    join(dir, 'src/app/page.tsx'),
    'export default function Home() {\n  return <h1>Home</h1>\n}\n',
  )
  mkdirSync(join(dir, 'src/server/db'), { recursive: true })
  writeFileSync(join(dir, 'src/server/db/schema.ts'), '// tables\n')
  writeFileSync(join(dir, 'src/server/db/index.ts'), DB_INDEX)

  const modules = join(dir, 'node_modules')
  mkdirSync(join(modules, '@theokit'), { recursive: true })
  symlinkSync(resolve(REPO, 'packages/theo'), join(modules, 'theokit'), 'dir')
  symlinkSync(resolve(REPO, 'packages/agents'), join(modules, '@theokit/agents'), 'dir')
  symlinkSync(packageDir(agentsRequire, '@theokit/sdk'), join(modules, '@theokit/sdk'), 'dir')
  symlinkSync(packageDir(agentsRequire, 'zod'), join(modules, 'zod'), 'dir')
  symlinkSync(drizzleDir, join(modules, 'drizzle-orm'), 'dir')

  await generated('route', 'hello')
  await generated('action', 'send-mail')
  await generated('page', 'about')
  await generated('ws', 'chat-room')
  controllerResult = await generated('controller', 'users')
  await generated('agent', 'support')
  await generated('toolbox', 'math')
  await generated('workflow', 'greeting')
  await generated('eval', 'qa-smoke')
  await generated('sandbox', 'run-command')
  await generated('memory', 'conversations')
  await generated('resource', 'posts', ['title:string'])

  // The step the controller notice asks for.
  symlinkSync(resolve(REPO, 'packages/http'), join(modules, '@theokit/http'), 'dir')

  vi.spyOn(console, 'log').mockImplementation(() => {})
  server = await startDevServer(dir, { port: 0 })
  const address = server.httpServer?.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  origin = `http://localhost:${String(port)}`
}, 240_000)

afterAll(async () => {
  await server?.close()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('every generated kind runs in a scaffolded app', () => {
  it('a generated route is served and refuses until its policy is decided', async () => {
    const response = await fetch(`${origin}/api/hello`)
    expect(response.status).toBe(403)
    expect(await refusal(response)).toContain('src/server/routes/hello.ts still carries the policy')

    const { GET } = (await load('src/server/routes/hello.ts')) as { GET: BuiltRoute }
    expect(await GET.handler({ ctx: {} })).toEqual({ message: 'TODO: implement hello GET' })
  })

  it('a generated action passes the test generated beside it', () => {
    // An empty config of the app's own, or vitest finds the repository's and runs its projects.
    writeFileSync(join(dir, 'vitest.config.mjs'), 'export default {}\n')
    const output = execFileSync(
      VITEST,
      ['run', '--config', join(dir, 'vitest.config.mjs'), 'src/server/actions/send-mail.test.ts'],
      { cwd: dir, encoding: 'utf8', stdio: 'pipe' },
    )
    expect(output).toMatch(/2 passed/)
  }, 120_000)

  it('a generated page is routed by its folder and renders its heading', async () => {
    const tree = scanRoutes(join(dir, 'src/app'))
    expect(JSON.stringify(tree)).toContain('src/app/about/page.tsx')

    const { renderToString } = await import('react-dom/server')
    const { createElement } = await import('react')
    const page = (await load('src/app/about/page.tsx')).default as () => unknown
    expect(renderToString(createElement(page as never))).toBe('<h1>About</h1>')
  })

  it('a generated websocket handler echoes over theokit dev', async () => {
    const socket = new WebSocket(`${origin.replace('http', 'ws')}/ws/chat-room`)
    try {
      const reply = await new Promise<string>((ok, fail) => {
        socket.once('open', () => socket.send('hi'))
        socket.once('message', (data) => ok(String(data)))
        socket.once('error', fail)
      })
      expect(reply).toBe('echo: hi')
    } finally {
      socket.close()
    }
  })

  it('a generated controller names the package to install, passes the build gates and refuses at /api/<name>', async () => {
    const distDir = join(dir, '.theokit/dist')
    const manifest = await emitControllerArtifacts({ serverDir: join(dir, 'src/server'), distDir })
    expect(manifest?.modules).toEqual(['controllers/users.controller.mjs'])

    const response = await fetch(`${origin}/api/users`)
    expect(response.status).toBe(403)

    expect(controllerResult.message).toContain('npm install @theokit/http reflect-metadata')
    expect(controllerResult.message).toContain('npm install -D @swc/core')
  }, 60_000)

  it('a generated agent is served under its name and refuses until its policy is decided', async () => {
    const response = await fetch(`${origin}/api/agents/support`, {
      method: 'POST',
      // The CSRF header a browser client sends; without it the request is refused before the policy.
      headers: { 'content-type': 'application/json', 'x-theo-action': '1' },
      body: JSON.stringify({ message: 'hi' }),
    })
    expect(response.status).toBe(403)
    expect(await refusal(response)).toContain('agent "support"')

    const agent = await load('src/server/agents/support.ts')
    const decision = (agent.policy as () => { allowed: boolean; reason: string })()
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('src/server/agents/support.ts still carries the policy')
  })

  it('a generated toolbox tool answers its input', async () => {
    const { mathHello } = (await load('src/server/toolboxes/math.tools.ts')) as {
      mathHello: BuiltTool
    }
    expect(mathHello.name).toBe('math_hello')
    expect(await mathHello.handler({ name: 'Ada' })).toBe('Hello, Ada!')
  })

  it('a generated workflow completes with the output its doc comment shows', async () => {
    const { greetingWorkflow } = (await load('src/server/agents/workflows/greeting.ts')) as {
      greetingWorkflow: { run: (input: unknown) => Promise<{ status: string; output: unknown }> }
    }
    const run = await greetingWorkflow.run({ name: ' Ada ' })
    expect(run.status).toBe('completed')
    expect(run.output).toBe('Hello, Ada!')
  })

  it('a generated eval scores a model answer', async () => {
    let requests = 0
    const provider: Server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        requests += 1
        const chunk = (delta: object, finish: string | null) =>
          `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(chunk({ role: 'assistant', content: 'ok' }, null))
        res.write(chunk({}, 'stop'))
        res.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>((ok) => provider.listen(0, '127.0.0.1', ok))
    const address = provider.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    vi.stubEnv('OPENROUTER_API_BASE_URL', `http://127.0.0.1:${String(port)}`)
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-local-fake-key-0000')
    try {
      const { qaSmokeEval } = (await load('src/server/agents/evals/qa-smoke.ts')) as {
        qaSmokeEval: {
          run: () => Promise<{ aggregate: { meanScore: number; errorRows: number } }>
        }
      }
      const run = await qaSmokeEval.run()
      expect(run.aggregate).toMatchObject({ meanScore: 1, errorRows: 0 })
      expect(requests).toBeGreaterThan(0)
    } finally {
      vi.unstubAllEnvs()
      await new Promise<void>((ok) => provider.close(() => ok()))
    }
  }, 60_000)

  it('a generated sandbox tool runs a shell command', async () => {
    const { runCommandTool } = (await load('src/server/agents/sandbox/run-command.ts')) as {
      runCommandTool: BuiltTool
    }
    expect(await runCommandTool.handler({ command: 'echo sandboxed' })).toBe('sandboxed\n')
  })

  it('a generated memory note loads and wires nothing', async () => {
    expect(Object.keys(await load('src/server/agents/memory/conversations.ts'))).toEqual([])
  })

  it('a generated resource is served, refuses until decided, and its handlers read and write the table', async () => {
    const response = await fetch(`${origin}/api/posts`)
    expect(response.status).toBe(403)
    expect(await refusal(response)).toContain('src/server/routes/posts/index.ts')

    const list = (await load('src/server/routes/posts/index.ts')) as {
      GET: BuiltRoute
      POST: BuiltRoute
    }
    const byId = (await load('src/server/routes/posts/[id].ts')) as {
      GET: BuiltRoute
      PUT: BuiltRoute
    }
    const row = (await list.POST.handler({ body: { title: 'first' } })) as { id: number }
    expect(row).toMatchObject({ id: 1, title: 'first' })
    expect(await byId.PUT.handler({ params: { id: 1 }, body: { title: 'renamed' } })).toMatchObject(
      { id: 1, title: 'renamed' },
    )
    expect(await byId.GET.handler({ params: { id: 1 } })).toMatchObject({ title: 'renamed' })
    expect(readFileSync(join(dir, 'src/server/db/schema.ts'), 'utf8')).toContain(
      "sqliteTable('posts'",
    )
  })
})
