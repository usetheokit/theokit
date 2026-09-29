/**
 * A Vercel deployment of an SSR project must serve a rendered document, not the static shell.
 *
 * `renderVercelConfigJson` emitted, in order: a header rule on `/(.*)` with `continue: true`;
 * `/api/(.*) -> /api`; `{ handle: 'filesystem' }`; `/(.*) -> /index.html`. **Nothing routed a page
 * request to the function**, so `/` was Vercel's static host serving `index.html` — an empty
 * `<div id="root">` — whatever the project declared. The build printed
 * `✓ Build complete → vercel (SSR)` over it.
 *
 * And the function could not have answered if it had been asked: `renderVercelFunctionEntry` emitted no
 * document branch at all. Measured 2026-09-28 (B-317) — `renderStreamingWeb`, `htmlHead` and
 * `injectModulePreloads` each appeared ZERO times in `vercel.ts` against six, five and one in
 * `cloudflare.ts`.
 *
 * ## Why the Vercel branch is smaller than Cloudflare's, and that is not a shortcut
 *
 * On Workers the worker owns `/` and therefore also receives `/robots.txt`, so its branch carries an
 * asset fallthrough and a pre-filter. Vercel's `{ handle: 'filesystem' }` serves every real file BEFORE
 * the fallback, so the function only ever sees a path with no matching file. There is nothing for it to
 * fall through to, and adding one would be a branch that cannot be reached.
 *
 * ## A trap this test walked into first
 *
 * `renderVercelConfigJson(securityHeaders?)` takes the headers, and `SecurityHeadersConfig` is
 * all-optional — so `renderVercelConfigJson({ ssr: true })` COMPILES, passes the flag as a headers
 * object, and does nothing. The flag is a second parameter for that reason: an options bag in the
 * position of another all-optional bag is accepted by the type system and ignored by the code.
 *
 * ## What the headers already did, and why that was not enough
 *
 * The adapter's docblock is honest about it: the `continue: true` rule puts the six security headers on
 * every response including the static document. So the headers arrived and the rendering did not — the
 * opposite of the Cloudflare defect, where the document was empty AND bare.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { pathToFileURL } from 'node:url'

import { describe, expect, it, onTestFinished } from 'vitest'

import {
  renderVercelConfigJson,
  renderVercelFunctionEntry,
} from '../../packages/theo/src/adapters/vercel.js'

// The string-aware stripper, shared. Seven files carried a byte-identical regex copy that read
// `"/*"` in netlify.ts as a comment opener and deleted 36% of that file (B-338).
import { withoutComments as code } from './_helpers/adapter-source.js'

const HEAD = '<!doctype html><html><head></head><body><div id="root">'
const TAIL = '</div></body></html>'

describe('the Vercel document is rendered by the function', () => {
  it('test_the_fallback_route_reaches_the_function_when_ssr_is_on', () => {
    // THE routing half. `handle: 'filesystem'` still precedes it, so a real file is still served by the
    // platform; what changes is where a path with no file goes.
    const { routes } = renderVercelConfigJson(undefined, { ssr: true })
    const fallback = routes.at(-1)

    expect(
      fallback,
      'the last rule is not the catch-all, so the order this test reads is not the order emitted',
    ).toMatchObject({ src: '/(.*)' })
    expect(
      (fallback as { dest?: string }).dest,
      'a page request goes to the static shell, so an SSR project is served an empty `<div id="root">`',
    ).toBe('/api')
  })

  it('test_a_static_project_still_gets_the_shell', () => {
    // COUNTERPROOF: routing every page to a function a static project does not need would be a
    // regression in the other direction, and an invocation billed for a file.
    const { routes } = renderVercelConfigJson(undefined, { ssr: false })

    expect((routes.at(-1) as { dest?: string }).dest).toBe('/index.html')
  })

  it('test_the_filesystem_handler_still_precedes_the_fallback', () => {
    // Without this, the function would be asked for `/assets/index-abc.js` too — an invocation per
    // asset, and a 404 from a handler that has no files.
    const { routes } = renderVercelConfigJson(undefined, { ssr: true })
    const handleAt = routes.findIndex((r) => (r as { handle?: string }).handle === 'filesystem')
    const fallbackAt = routes.length - 1

    expect(handleAt, 'the filesystem handler is gone').toBeGreaterThanOrEqual(0)
    expect(handleAt).toBeLessThan(fallbackAt)
  })

  it('test_the_entry_renders_a_document_for_a_non_api_path', () => {
    // The rendering half. The app's own SSR entry is what renders — the same module the Cloudflare
    // worker imports, and `bundleDeployedFunction` inlines it, so the uploaded directory carries it.
    const entry = code(renderVercelFunctionEntry({ ssr: true, htmlHead: HEAD, htmlTail: TAIL }))

    expect(
      entry,
      'the entry has no document branch, so a page request reaching it answers a JSON 404',
    ).toContain('renderStreamingWeb')
    expect(entry).toContain("from '../server/entry-server.js'")
    expect(entry).toContain(JSON.stringify(HEAD))
    expect(entry).toContain(JSON.stringify(TAIL))
  })

  it('test_the_rendered_document_carries_the_security_baseline', () => {
    // The headers arrive today through the `continue: true` rule on every response. The document now
    // comes from the function, so the function's own response must carry them too — otherwise the fix
    // moves the document out from under the rule that was protecting it.
    const entry = code(renderVercelFunctionEntry({ ssr: true, htmlHead: HEAD, htmlTail: TAIL }))

    expect(entry).toContain('withSecurityHeaders')
  })

  it('test_a_static_project_emits_no_document_branch', () => {
    // COUNTERPROOF for the entry: emitting a renderer a static project never calls would bundle the
    // app's whole SSR graph into a function for nothing.
    const entry = code(renderVercelFunctionEntry({ ssr: false }))

    expect(entry).not.toContain('renderStreamingWeb')
  })
})

/**
 * The document branch is EXECUTED, not inspected.
 *
 * The first version of this fix was asserted by presence — `expect(entry).toContain('renderStreamingWeb')`
 * — and shipped a branch that was never entered. An early guard at the top of `routeRequest` refused
 * every path outside `/api/`, which was correct while the function answered only routes and made the new
 * branch unreachable the moment it was added. Measured by running the built function: `/` answered a
 * 9-byte `Not Found` with `content-type: text/plain` while the entry contained the renderer and the test
 * was green.
 *
 * So this drives the emitted module. The specifier rewrite is the same shape
 * `tests/smoke/a-throwing-context-answers-500-not-anonymously.test.ts` uses, derived from the package's
 * own `exports`; the app's SSR entry is stubbed, because what is under test is whether the branch is
 * REACHED and what it does with the result, not how an app renders.
 */
describe('the Vercel document branch is reached', () => {
  const SHELL_HEAD = '<!doctype html><html><head><title>t</title></head><body><div id="root">'
  const SHELL_TAIL = '</div></body></html>'

  async function loadFunction(): Promise<(req: IncomingMessage, res: ServerResponse) => unknown> {
    const dir = mkdtempSync(join(tmpdir(), 'theo-vercel-entry-'))
    onTestFinished(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    // The app's renderer, stubbed. It returns what `renderStreamingWeb` returns — a Response — so the
    // branch's own work (the nonce, the headers, the shell) is what the cases below observe.
    mkdirSync(join(dir, 'server'), { recursive: true })
    writeFileSync(
      join(dir, 'server', 'entry-server.js'),
      `export async function renderStreamingWeb(request, opts) {
` +
        `  return new Response(opts.htmlHead + '<!--app:' + new URL(request.url).pathname + '-->' + opts.htmlTail, {
` +
        `    headers: { 'content-type': 'text/html; charset=utf-8' },
` +
        `  })
` +
        `}
`,
    )

    const PKG = resolve(__dirname, '../../packages/theo/package.json')
    const ROOT = resolve(__dirname, '../../packages/theo')
    const built: Record<string, string> = Object.fromEntries(
      Object.entries(
        JSON.parse(readFileSync(PKG, 'utf8')).exports as Record<
          string,
          { import?: string } | string
        >,
      )
        .filter(
          (e): e is [string, { import: string }] =>
            e[0].startsWith('./') && typeof (e[1] as { import?: string })?.import === 'string',
        )
        .map(([sub, target]) => [`theokit${sub.slice(1)}`, resolve(ROOT, target.import)]),
    )

    const source = renderVercelFunctionEntry({
      ssr: true,
      htmlHead: SHELL_HEAD,
      htmlTail: SHELL_TAIL,
      // No baked routes: their imports are relative `.ts` paths that vite resolves at build time, and
      // this harness loads the entry with node. An empty table is the right fixture anyway — what is
      // under test is whether a path OUTSIDE `/api/` reaches the document branch, and `/api/…` still
      // answering its JSON 404 is the counterproof.
    }).replace(/^(\s*import[^\n]*?from\s+)'([^']+)'/gm, (whole, prefix: string, spec: string) => {
      if (spec in built) return `${prefix}'${pathToFileURL(built[spec] as string).href}'`
      if (spec === 'theokit' || spec.startsWith('theokit/')) {
        throw new Error(`the entry imports '${spec}', which packages/theo does not export`)
      }
      return whole
    })

    mkdirSync(join(dir, 'vercel'), { recursive: true })
    const file = join(dir, 'vercel', 'entry.mjs')
    writeFileSync(file, source)

    const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
      default: (req: IncomingMessage, res: ServerResponse) => unknown
    }
    return mod.default
  }

  async function ask(path: string): Promise<{ status: number; body: string; type: string | null }> {
    const handler = await loadFunction()
    const server = createServer((req, res) => {
      // The rejection is HANDLED, not discarded. `void` would satisfy `no-floating-promises` and turn a
      // throw inside the handler into an unhandled rejection — which surfaces as a hanging `fetch`
      // rather than as the error, and hides exactly the kind of failure these cases exist to catch.
      Promise.resolve(handler(req, res)).catch((err: unknown) => {
        res.statusCode = 500
        res.end(`the emitted handler threw: ${String(err)}`)
      })
    })
    await new Promise<void>((r) => {
      server.listen(0, '127.0.0.1', r)
    })
    onTestFinished(() => {
      server.close()
    })
    const { port } = server.address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${String(port)}${path}`)
    return {
      status: response.status,
      body: await response.text(),
      type: response.headers.get('content-type'),
    }
  }

  it('test_a_page_request_gets_a_document_rather_than_a_404', async () => {
    // THE case, and the one presence could not make. Before the early guard was made conditional this
    // was 404 / 9 bytes / text/plain, with the renderer sitting in the file unreached.
    const answer = await ask('/')

    expect(answer.status, 'the page request was refused before the document branch').toBe(200)
    expect(answer.type).toContain('text/html')
    expect(answer.body).toContain('<!--app:/-->')
    expect(answer.body).toContain(SHELL_HEAD)
  })

  it('test_a_deep_link_is_rendered_too', async () => {
    // A client route matches no file and no API route. On the static shell it worked by accident; here
    // it must reach the renderer with its own pathname.
    const answer = await ask('/dashboard/settings')

    expect(answer.status).toBe(200)
    expect(answer.body).toContain('<!--app:/dashboard/settings-->')
  })

  it('test_an_unknown_api_path_is_still_a_json_404', async () => {
    // COUNTERPROOF: rendering a document for a path under `/api/` would answer a fetch with HTML. The
    // document branch is deliberately scoped OUTSIDE that prefix.
    const answer = await ask('/api/nope')

    expect(answer.status).toBe(404)
    expect(answer.type).toContain('application/json')
  })
})
