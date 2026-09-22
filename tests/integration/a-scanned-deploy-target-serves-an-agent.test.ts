import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildBun, renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'

/**
 * SI-023, raised by the inventory judge on its fourth pass.
 *
 * `deployedAgentsFragment` emits TWO different programs. `bakedResolution` writes a name-keyed
 * literal table and a baked context import; `scannedResolution` writes `scanAgents` + a cache, a
 * `find` over it, and `createAgentSubjectResolver` against the host's own `serverDir` — the other
 * half of ADR 0014. Every worker-EXECUTION test in this repository drives cloudflare, which is
 * baked. The scanned half was only ever PARSED, and the CHANGELOG's claim that "Bun and Deno
 * locate their own server/context.ts" rested on `toContain` over emitted text.
 *
 * `node --check` does not care whether the program is correct. Only running it does.
 *
 * This drives both scanned targets. The judge's mutation M9 — keying the lookup by `filePath`
 * instead of `name` — survived 274 tests; it dies here, because a request for `/api/agents/chat`
 * then finds no node and never reaches `mountAgent`.
 */
const STUB_SOURCE = `
import nodeFs from 'node:fs'
import nodePath from 'node:path'
export const scanServerRoutes = () => []
export const scanWebSocketRoutes = () => []
export const matchRoute = () => null
export const compilePattern = () => ({})
export const executeRoute = () => {}
export const createProductionLoader = () => async () => ({ default: {} })
export const createWebShim = () => ({ req: { headers: {} }, res: { setHeader() {} }, toResponse: () => new Response('r') })
export const generateNonce = () => 'n'
export const buildSecurityHeaders = () => ({})
export const withSecurityHeaders = (r) => r
export const createBunWsBridge = () => ({ handle: () => new Response(null) })
export const createDenoWsBridge = () => ({ handle: () => new Response(null) })
export const renderStreamingWeb = () => new Response('')
export const extractTraceIdFromRequest = () => 't'
export const TRACE_HEADER = 'x-trace-id'
export const createCorsWebHandler = () => null
export const createPluginRunnerFromConfig = async () => undefined
export const resolveTransformer = (s) => ({ name: s })
export const resolveProvider = () => ({ apiKey: 'sk-test' })
export const matchAgentAuxRoute = () => null
export const serveMatchedAuxRoute = () => new Response('')

// The two halves this file exists to execute.
globalThis.__theoSeen = { scans: 0, resolverArgs: [], scanArgs: [] }
export const scanAgents = (projectRoot, agentsDirName = 'agents') => {
  globalThis.__theoSeen.scans += 1
  globalThis.__theoSeen.scanArgs.push({ projectRoot, agentsDirName })
  const dir = nodePath.join(projectRoot, agentsDirName)
  if (!nodeFs.existsSync(dir)) return []
  return nodeFs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      const name = f.slice(0, -3)
      return { name, filePath: nodePath.join(dir, f), agentPath: '/api/agents/' + name }
    })
}
export const createAgentSubjectResolver = (deps) => {
  globalThis.__theoSeen.resolverArgs.push(deps)
  return async () => ({ id: 'owner' })
}
export const mountAgent = (mod, request, apiKey, opts) =>
  new Response('agent ran: ' + (opts?.agentName ?? 'unnamed') + ' | module ' + (mod === undefined ? 'missing' : 'loaded'))
`

let root: string
let customDirRoot: string
let stubUrl: string
let serial = 0

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-scanned-'))
  writeFileSync(join(root, 'theo-stub.mjs'), STUB_SOURCE)
  stubUrl = pathToFileURL(join(root, 'theo-stub.mjs')).href
  mkdirSync(join(root, 'agents'), { recursive: true })
  writeFileSync(join(root, 'agents', 'chat.js'), `export default { name: 'chat' }\n`)
  mkdirSync(join(root, 'server'), { recursive: true })

  // F-92b7b572. A project whose `agentsDir` is `core/agents` — the value the config's own
  // docblock gives as its example (`config/schema.ts:66`). No `agents/` directory exists here,
  // so a scan that ignores the configured name finds nothing at all.
  customDirRoot = mkdtempSync(join(tmpdir(), 'theo-scanned-customdir-'))
  writeFileSync(join(customDirRoot, 'theo-stub.mjs'), STUB_SOURCE)
  mkdirSync(join(customDirRoot, 'core', 'agents'), { recursive: true })
  writeFileSync(
    join(customDirRoot, 'core', 'agents', 'chat.js'),
    `export default { name: 'chat' }\n`,
  )
  mkdirSync(join(customDirRoot, 'server'), { recursive: true })
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).Bun
  delete (globalThis as Record<string, unknown>).Deno
})

type Handler = (request: Request) => Promise<Response>

/** What the stub records. Read through one accessor so the cast lives in a single place. */
interface Seen {
  scans: number
  resolverArgs: { serverDir?: string }[]
  scanArgs: { projectRoot: string; agentsDirName: string }[]
}
const seenNow = (): Seen => (globalThis as unknown as { __theoSeen: Seen }).__theoSeen
const resetSeen = (): void => {
  ;(globalThis as unknown as { __theoSeen: Seen }).__theoSeen = {
    scans: 0,
    resolverArgs: [],
    scanArgs: [],
  }
}

/**
 * Provides the runtime each entry demands, then imports it. Both call `<Runtime>.serve` at module
 * scope and hand it the handler, so capturing that call IS how the handler is reached — there is
 * no export to import. Both also guard their runtime at module scope and `process.exit(1)` or
 * throw when it is absent, which is why the globals go up BEFORE the import.
 */
/** Write a rendered entry into the fixture, import it, and return the handler it hands to serve(). */
async function executeEmitted(tag: string, source: string, projectRoot: string): Promise<Handler> {
  let captured: Handler | undefined
  const previousNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  ;(globalThis as Record<string, unknown>).Bun = {
    version: '1.2.0',
    serve: (options: { fetch: (r: Request, s: unknown) => Promise<Response> }) => {
      captured = (request: Request) => options.fetch(request, { upgrade: () => false })
      return { stop() {} }
    },
    file: (path: string) => `file:${path}`,
  }
  const dir = join(projectRoot, '.theokit', 'built')
  mkdirSync(dir, { recursive: true })
  serial += 1
  const file = join(dir, `entry-${tag}-${serial}.mjs`)
  writeFileSync(
    file,
    `process.chdir(${JSON.stringify(projectRoot)})\n` +
      source.replace(/^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gm, `$1'${stubUrl}'`),
  )
  await import(/* @vite-ignore */ pathToFileURL(file).href)
  process.env.NODE_ENV = previousNodeEnv
  if (captured === undefined) throw new Error('the built entry never called serve()')
  return captured
}

async function loadScanned(kind: 'bun' | 'deno', projectRoot: string = root): Promise<Handler> {
  let captured: Handler | undefined
  const previousNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'

  if (kind === 'bun') {
    ;(globalThis as Record<string, unknown>).Bun = {
      version: '1.2.0',
      serve: (options: { fetch: (r: Request, s: unknown) => Promise<Response> }) => {
        captured = (request: Request) => options.fetch(request, { upgrade: () => false })
        return { stop() {} }
      },
      file: (path: string) => `file:${path}`,
    }
  } else {
    ;(globalThis as Record<string, unknown>).Deno = {
      version: { deno: '1.44.0' },
      env: { get: () => undefined },
      cwd: () => projectRoot,
      serve: (_options: unknown, handler: Handler) => {
        captured = handler
        return { finished: Promise.resolve() }
      },
    }
  }

  // No options: on both targets the agents fragment is unconditional, so there is nothing to
  // switch on. An earlier version passed `agentsEnabled: true` and `ssrStreaming: false`, which
  // neither signature accepts — it read as configuration and was inert.
  const source = kind === 'bun' ? renderBunEntry(3000) : renderDenoEntry(3000)

  const dir = join(projectRoot, '.theokit', kind)
  mkdirSync(dir, { recursive: true })
  serial += 1
  // A fresh filename per load: ESM caches by url, and two of these tests import the same
  // rendered entry with different harness state.
  const file = join(dir, `entry-${serial}.mjs`)
  writeFileSync(
    file,
    // Bun's entry reads `process.cwd()`; pinning it to the fixture keeps `serverDir` inside it.
    `process.chdir(${JSON.stringify(projectRoot)})\n` +
      source.replace(/^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gm, `$1'${stubUrl}'`),
  )
  await import(/* @vite-ignore */ pathToFileURL(file).href)

  process.env.NODE_ENV = previousNodeEnv
  if (captured === undefined) throw new Error(`${kind} entry never called serve()`)
  return captured
}

describe('a scanned deploy target serves an agent through its emitted entry', () => {
  for (const kind of ['bun', 'deno'] as const) {
    it(`test_a_${kind}_entry_reaches_the_agent_the_scan_reported`, async () => {
      resetSeen()
      const handler = await loadScanned(kind)

      const response = await handler(new Request('https://app.test/api/agents/chat'))

      // Keying the lookup by `filePath` instead of `name` — a mutation that survived 274 tests —
      // finds no node here and never reaches mountAgent.
      expect(response.status, 'the scanned lookup did not reach the agent').toBe(200)
      expect(await response.text()).toBe('agent ran: chat | module loaded')
    })

    it(`test_a_${kind}_entry_resolves_identity_against_its_own_server_dir`, async () => {
      resetSeen()
      const handler = await loadScanned(kind)

      await handler(new Request('https://app.test/api/agents/chat'))

      const seen = seenNow()
      // ADR 0014's second mechanism: a host WITH a filesystem is handed its own directory rather
      // than a baked module. Asserting the call happened AND what it carried — a resolver built
      // with no serverDir would satisfy a laxer check and resolve nobody.
      expect(
        seen.resolverArgs.length,
        'createAgentSubjectResolver was never called',
      ).toBeGreaterThan(0)
      expect(seen.resolverArgs[0]?.serverDir).toContain('server')
    })
  }

  it('test_a_project_with_a_configured_agents_dir_is_served', async () => {
    // F-92b7b572 and F-59e471e0. This drives `buildBun` — the PRODUCTION caller — rather than
    // `renderBunEntry`. The distinction is the whole finding: `serverDirLiteral` existed, and
    // `deploy-adapters-honour-server-dir.test.ts:29` proved the renderer honours the option by
    // passing the option itself, while no build ever supplied it. A test that passes the option
    // here would reproduce that blind spot instead of closing it.
    resetSeen()
    let emitted = ''
    await buildBun(
      {
        port: 3000,
        serverDir: 'core',
        agentsDir: 'core/agents',
        appDir: 'app',
        outDir: 'dist',
        ssr: false,
        ssrStreaming: false,
      } as never,
      customDirRoot,
      {
        runNodeBuild: async () => {},
        ensureDir: () => {},
        writeEntry: (_path: string, content: string) => {
          emitted = content
        },
      } as never,
    )

    expect(emitted, 'the configured server directory never reached the entry').toContain(
      'resolve(cwd, "core")',
    )
    const handler = await executeEmitted('bun-configured-dirs', emitted, customDirRoot)
    const response = await handler(new Request('https://app.test/api/agents/chat'))

    expect(
      seenNow().scanArgs[0]?.agentsDirName,
      'the build passed no directory, so the default won over the configured value',
    ).toBe('core/agents')
    expect(response.status, 'an agent under a configured agentsDir was not served').toBe(200)
  })

  it('test_an_agent_the_scan_did_not_report_is_not_served', async () => {
    resetSeen()
    const handler = await loadScanned('bun')

    const response = await handler(new Request('https://app.test/api/agents/nope'))

    // The negative control. Without it, a lookup that returned the first node for any name would
    // pass every assertion above.
    expect(response.status, 'an unknown agent name was served anyway').not.toBe(200)
  })
})
