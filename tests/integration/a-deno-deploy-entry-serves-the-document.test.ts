import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildDeno, renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'

/**
 * The Deno Deploy entry serves the client build itself (#951).
 *
 * Measured 2026-10-03 on a `create-theokit@3.0.14` scaffold deployed to Deno Deploy as a dynamic
 * app with `theokit-deploy/server.ts` as the entrypoint: `/api/health` answered 200 and `/`,
 * `/about` and every asset answered the entry's own `{"error":{"code":"NOT_FOUND"}}`. The entry
 * returned 404 for every non-API path on the stated assumption that "Deno Deploy's static asset
 * handler" serves them, and a dynamic app has no such handler.
 *
 * Served from `theokit-deploy/client`, which the build copies there: the upload honours `.gitignore`,
 * the scaffold ignores `.theokit/`, and uploading `.theokit` anyway broke every agent route (its
 * `manifest.json` carries the build machine's absolute paths). Both measured on the platform.
 *
 * Executed, not grepped: the rendered entry is imported with `Deno` provided over the real
 * filesystem, and requests go through the handler it hands to `Deno.serve`.
 */
const STUB_SOURCE = `
export const scanServerRoutes = () => []
export const scanWebSocketRoutes = () => []
export const matchRoute = () => null
export const executeRoute = () => {}
export const createProductionLoader = () => async () => ({ default: {} })
export const createWebShim = () => ({ req: { headers: {} }, res: { setHeader() {} }, toResponse: () => new Response('r') })
export const buildSecurityHeaders = () => ({ 'X-Frame-Options': 'DENY' })
export const withSecurityHeaders = (r, h) => { for (const [k, v] of Object.entries(h)) r.headers.set(k, v); return r }
export const createDenoWsBridge = () => ({ handle: () => new Response(null) })
export const extractTraceIdFromRequest = () => 't'
export const TRACE_HEADER = 'x-trace-id'
export const createCorsWebHandler = () => null
export const createPluginRunnerFromConfig = async () => undefined
export const resolveTransformer = (s) => ({ name: s })
export const resolveProvider = () => ({ apiKey: 'sk-test' })
export const matchAgentAuxRoute = () => null
export const serveMatchedAuxRoute = () => new Response('')
export const scanAgents = () => []
export const createAgentSubjectResolver = () => async () => ({ id: 'owner' })
export const mountAgent = () => new Response('agent')
`

const DOCUMENT = '<!doctype html><html><head></head><body><div id="root"></div></body></html>'

let root: string
let stubUrl: string
let serial = 0

class NotFound extends Error {}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-deno-client-'))
  writeFileSync(join(root, 'theo-stub.mjs'), STUB_SOURCE)
  stubUrl = pathToFileURL(join(root, 'theo-stub.mjs')).href
  mkdirSync(join(root, 'server'), { recursive: true })
  mkdirSync(join(root, 'theokit-deploy', 'client', 'assets'), { recursive: true })
  writeFileSync(join(root, 'theokit-deploy', 'client', 'index.html'), DOCUMENT)
  writeFileSync(join(root, 'theokit-deploy', 'client', 'assets', 'index-abc.js'), 'console.log(1)')
  writeFileSync(join(root, 'secret.txt'), 'outside the client build')
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).Deno
})

type Handler = (request: Request) => Promise<Response>

async function loadEntry(): Promise<Handler> {
  let captured: Handler | undefined
  ;(globalThis as Record<string, unknown>).Deno = {
    version: { deno: '2.0.0' },
    env: { get: () => undefined },
    cwd: () => root,
    errors: { NotFound },
    readFile: async (path: string) => {
      try {
        return new Uint8Array(readFileSync(path))
      } catch {
        throw new NotFound(path)
      }
    },
    serve: (_options: unknown, handler: Handler) => {
      captured = handler
      return { finished: Promise.resolve() }
    },
  }
  const dir = join(root, '.theokit', 'deno')
  mkdirSync(dir, { recursive: true })
  serial += 1
  const file = join(dir, `entry-${serial}.mjs`)
  writeFileSync(
    file,
    renderDenoEntry(3000).replace(
      /^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gm,
      `$1'${stubUrl}'`,
    ),
  )
  await import(/* @vite-ignore */ pathToFileURL(file).href)
  if (captured === undefined) throw new Error('the deno entry never called Deno.serve()')
  return captured
}

const get = async (path: string): Promise<Response> =>
  (await loadEntry())(new Request(`https://app.test${path}`))

describe('the Deno Deploy entry serves the client build', () => {
  it('test_the_root_answers_the_document', async () => {
    const response = await get('/')

    expect(response.status, 'the document is a 404 on a dynamic Deno Deploy app').toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toBe(DOCUMENT)
  })

  it('test_a_client_route_answers_the_document', async () => {
    const response = await get('/about')

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(DOCUMENT)
  })

  it('test_an_asset_answers_its_bytes_and_type', async () => {
    const response = await get('/assets/index-abc.js')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('javascript')
    expect(await response.text()).toBe('console.log(1)')
  })

  it('test_a_missing_asset_is_a_404_not_the_document', async () => {
    expect((await get('/assets/gone.js')).status).toBe(404)
  })

  it('test_the_document_carries_the_security_headers', async () => {
    expect((await get('/')).headers.get('x-frame-options')).toBe('DENY')
  })

  it('test_nothing_outside_the_client_build_is_reachable', async () => {
    const response = await get('/%2e%2e/%2e%2e/secret.txt')

    expect(await response.text()).not.toContain('outside the client build')
  })

  it('test_an_unknown_api_path_is_still_the_json_404', async () => {
    const response = await get('/api/nope')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND' } })
  })
})

describe('the Deno Deploy build puts the client where the upload carries it', () => {
  it('test_the_build_copies_the_client_build_beside_the_entry', async () => {
    const copies: { from: string; to: string }[] = []

    await buildDeno({ port: 3000 } as TheoConfig, '/project', {
      runNodeBuild: async () => {},
      writeEntry: () => {},
      ensureDir: () => {},
      readProjectSources: () => [],
      readDenoConfig: () => undefined,
      copyClient: (from, to) => copies.push({ from, to }),
    })

    expect(copies).toEqual([
      { from: '/project/.theokit/client', to: '/project/theokit-deploy/client' },
    ])
  })
})
