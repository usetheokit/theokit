import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect } from 'vitest'

/**
 * Load an emitted deploy entry and drive its handler, the way the platform would.
 *
 * Six targets, six calling conventions and three response shapes: `cloudflare` and `netlify`
 * export a handler returning a `Response`; `bun` and `deno-deploy` export nothing and hand theirs
 * to `serve`; `vercel` returns undefined and drains into `nodeRes`; `aws-lambda` returns a v2
 * result object. A driver that only knew one of them would report the other five as passing
 * without exercising anything.
 *
 * Extracted from `every-deployed-entry-limits-its-caller.test.ts` when a second suite needed to
 * drive the same entries (usetheokit/theokit#1097).
 *
 * ## Why the specifiers are rewritten to `dist`
 *
 * Every entry opens with STATIC bare imports (`theokit/server/http`, `theokit/adapters/web-shim`,
 * ...); the deno one prefixes them `npm:`. Node has no `npm:` scheme and there is no
 * `node_modules/theokit` at the repository root, so neither form resolves from a temp directory.
 * Resolving through `packages/theo/dist` and the package's own `exports` map is what a deployed
 * entry actually imports. The caller builds the package first (`buildTheokitPackageOnce`).
 *
 * ## Why two entries need runtime stubs
 *
 * `bun` and `deno-deploy` call `Bun.serve({...})` and `Deno.serve(...)` at module scope, and read
 * other globals first. Bun calls `process.exit(1)` on each failed guard, so a partial stub
 * terminates the vitest worker instead of failing a test.
 */

export const DEPLOY_TARGETS = [
  'cloudflare',
  'bun',
  'deno-deploy',
  'vercel',
  'netlify',
  'aws-lambda',
] as const

export type DeployTarget = (typeof DEPLOY_TARGETS)[number]

/** One request to send through the entry. */
export interface DrivenRequest {
  readonly path: string
  readonly headers?: Record<string, string>
  /** The caller's address as the runtime itself reports it (bun's server, deno's info, ...). */
  readonly address?: string
}

/** What came back, reduced to what the suites assert on. */
export interface DrivenResponse {
  readonly status: number
  readonly contentType: string
  readonly body: string
}

const REPO = resolve(__dirname, '../../..')
const THEO = resolve(REPO, 'packages/theo')

/** Every bare specifier the six entries emit, measured rather than assumed. */
const SPECIFIER_RE = /from '(npm:)?(theokit\/[a-z/-]+)'/g

/** Resolve a published subpath the way a consumer's runtime does: through the exports map. */
function resolvePublished(subpath: string): string {
  const pkg = JSON.parse(readFileSync(join(THEO, 'package.json'), 'utf8')) as {
    exports: Record<string, { import?: string } | string>
  }
  const entry = pkg.exports[subpath]
  const spec = typeof entry === 'string' ? entry : entry?.import
  if (spec === undefined) throw new Error(`theokit does not publish "${subpath}"`)
  return resolve(THEO, spec)
}

/**
 * Rewrite every `theokit/X` to a `file://` URL under `dist`, asserting the `npm:` prefix was where
 * it belongs first. A deno entry emitting a bare specifier is its own defect, and rewriting without
 * checking would trade one blind spot for another.
 */
function toDistSpecifiers(source: string, target: DeployTarget): string {
  const prefixed = [...source.matchAll(SPECIFIER_RE)].filter((m) => m[1] === 'npm:')
  if (target === 'deno-deploy') {
    expect(prefixed.length, 'the deno entry must emit `npm:` specifiers').toBeGreaterThan(0)
  } else {
    expect(prefixed, `${target} must not emit npm: specifiers`).toHaveLength(0)
  }
  return source.replace(SPECIFIER_RE, (_all, _npm: string | undefined, bare: string) => {
    const subpath = bare.replace(/^theokit/, '.')
    return `from ${JSON.stringify(pathToFileURL(resolvePublished(subpath)).href)}`
  })
}

type WebHandler = (
  request: Request,
  second?: unknown,
) => Promise<Response | undefined> | Response | undefined

/**
 * Install what `bun` and `deno-deploy` read at module scope before `serve`: bun exits unless
 * `NODE_ENV` is production, `Bun` exists and `Bun.version` parses to >= 1.1; deno throws unless
 * `Deno` exists, and reads `Deno.env.get` and `Deno.cwd`.
 */
function installRuntimeStubs(workspace: string, captured: { handler?: WebHandler }): () => void {
  const g = globalThis as Record<string, unknown>
  const before = { Bun: g.Bun, Deno: g.Deno, env: process.env.NODE_ENV }
  process.env.NODE_ENV = 'production'
  g.Bun = {
    version: '1.2.0',
    file: () => ({ exists: async () => false }),
    serve: (o: { fetch?: WebHandler }) => {
      captured.handler = o.fetch
      return { stop: () => undefined }
    },
  }
  g.Deno = {
    env: { get: () => undefined },
    cwd: () => workspace,
    serve: (_o: unknown, h?: WebHandler) => {
      captured.handler = h
      return { finished: Promise.resolve() }
    },
  }
  return () => {
    g.Bun = before.Bun
    g.Deno = before.Deno
    process.env.NODE_ENV = before.env
  }
}

/** The runtime's own report of the caller, in the shape each target hands its handler. */
function runtimeSecond(target: DeployTarget, address: string | undefined): unknown {
  // `bun` gets a `server` either way: `Bun.serve` always passes one. What CAN happen is
  // `requestIP` returning nothing (a connection already gone).
  if (target === 'bun')
    return { requestIP: () => (address === undefined ? undefined : { address }) }
  if (address === undefined) return undefined
  if (target === 'netlify') return { ip: address }
  if (target === 'deno-deploy') return { remoteAddr: { hostname: address } }
  return undefined
}

function driveAwsLambda(mod: Record<string, unknown>) {
  const handler = mod.handler as (event: unknown) => Promise<{
    statusCode: number
    headers?: Record<string, string>
    body?: string
    isBase64Encoded?: boolean
  }>
  return async (request: DrivenRequest): Promise<DrivenResponse> => {
    const result = await handler({
      requestContext: { http: { method: 'GET', path: request.path, sourceIp: request.address } },
      headers: request.headers ?? {},
      rawPath: request.path,
    })
    const raw = result.body ?? ''
    return {
      status: result.statusCode,
      contentType: result.headers?.['content-type'] ?? '',
      body: result.isBase64Encoded === true ? Buffer.from(raw, 'base64').toString('utf8') : raw,
    }
  }
}

function driveVercel(mod: Record<string, unknown>) {
  const handler = mod.default as (req: unknown, res: unknown) => Promise<void>
  return async (request: DrivenRequest): Promise<DrivenResponse> => {
    let status = 0
    let contentType = ''
    const chunks: Buffer[] = []
    const res = {
      writeHead: (s: number, headers?: Record<string, string> | [string, string][]) => {
        status = s
        const entries = Array.isArray(headers) ? headers : Object.entries(headers ?? {})
        for (const [k, v] of entries) if (k.toLowerCase() === 'content-type') contentType = v
        return res
      },
      flushHeaders: () => undefined,
      write: (chunk: Uint8Array | string) => {
        chunks.push(Buffer.from(chunk))
        return true
      },
      end: (chunk?: Uint8Array | string) => {
        if (chunk !== undefined) chunks.push(Buffer.from(chunk))
        return res
      },
      once: () => res,
      off: () => res,
      destroy: () => res,
    }
    await handler(
      { method: 'GET', url: request.path, headers: { host: 'app.test', ...request.headers } },
      res,
    )
    return { status, contentType, body: Buffer.concat(chunks).toString('utf8') }
  }
}

/**
 * Write `source` into its own directory under `workspace`, load it, and return a driver.
 *
 * @param workspace - a temp directory the caller owns and removes.
 */
export async function loadDeployedEntry(
  target: DeployTarget,
  source: string,
  workspace: string,
): Promise<(request: DrivenRequest) => Promise<DrivenResponse>> {
  const dir = mkdtempSync(join(workspace, `${target}-`))
  const file = join(dir, 'entry.mjs')
  writeFileSync(file, toDistSpecifiers(source, target))

  const captured: { handler?: WebHandler } = {}
  const restore = installRuntimeStubs(workspace, captured)
  let mod: Record<string, unknown>
  try {
    mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
  } finally {
    restore()
  }

  if (target === 'aws-lambda') return driveAwsLambda(mod)
  if (target === 'vercel') return driveVercel(mod)

  const exported =
    typeof mod.default === 'function'
      ? (mod.default as WebHandler)
      : (mod.default as { fetch?: WebHandler } | undefined)?.fetch
  const handler = captured.handler ?? exported
  expect(handler, `${target} exposes no drivable handler`).toBeTypeOf('function')
  // `!` after the assertion above, not instead of it: if the handler is absent the expect() has
  // already failed the test, so nothing downstream can run on a nullish value.
  const drivable = handler!

  return async (request) => {
    const response = await drivable(
      new Request(`https://app.test${request.path}`, { headers: request.headers ?? {} }),
      runtimeSecond(target, request.address),
    )
    // The four Web-shaped targets always answer with a `Response`. An `undefined` here is a
    // defect in the emitted entry, and `!` surfaces it as a TypeError naming this line.
    return {
      status: response!.status,
      contentType: response!.headers.get('content-type') ?? '',
      body: await response!.text(),
    }
  }
}
