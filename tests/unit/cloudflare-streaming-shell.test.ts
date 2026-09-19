import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, describe, it, expect } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'

/**
 * usetheokit/theokit#343, second half. The streaming document assembly was fixed
 * in the generated entry and left unfixed at its only caller: the Cloudflare
 * worker called `renderStreamingWeb(request)` with no options, and both
 * `htmlHead` and `htmlTail` default to the empty string. So on Workers the
 * response was still React output with no `<html>`, no `<head>`, no stylesheet
 * and no client entry - hydration data for a page that cannot hydrate.
 *
 * Fixing a helper and not its caller is the shape of defect this programme keeps
 * finding; this is the same one, authored by the same fix.
 */

const HEAD = '<!doctype html><html><head><title>t</title></head><body><div id="root">'
const TAIL = '</div><script type="module" src="/entry-client.js"></script></body></html>'

describe('the Cloudflare worker hands the renderer its document shell (#343)', () => {
  it('test_the_streaming_call_passes_the_template', () => {
    const entry = renderCloudflareWorkerEntry({
      ssrStreaming: true,
      htmlHead: HEAD,
      htmlTail: TAIL,
    })

    expect(entry).toContain('renderStreamingWeb(request, {')
    expect(entry).toContain('<head>')
    expect(entry).toContain('entry-client.js')
  })

  it('test_the_inlined_template_survives_being_embedded_in_source', () => {
    // The shell contains quotes, angle brackets and a closing script tag. Embedded
    // naively it produces a worker that fails to parse at DEPLOY time rather than
    // here, which is the worst place for this to surface.
    const entry = renderCloudflareWorkerEntry({
      ssrStreaming: true,
      htmlHead: HEAD,
      htmlTail: TAIL,
    })

    // Parsed rather than evaluated: the generator emits `JSON.stringify` output,
    // so `JSON.parse` round-trips it exactly and no code from the fixture runs.
    expect(JSON.parse(extractLiteral(entry, 'htmlHead'))).toBe(HEAD)
    expect(JSON.parse(extractLiteral(entry, 'htmlTail'))).toBe(TAIL)
  })

  it('test_streaming_off_does_not_emit_a_template', () => {
    const entry = renderCloudflareWorkerEntry({ ssrStreaming: false })

    expect(entry).not.toContain('renderStreamingWeb(request, {')
  })
})

/**
 * The same question, asked by EXECUTING the entry rather than by reading it.
 *
 * ## Why the three cases above are not enough
 *
 * `expect(entry).toContain('<head>')` passes whether or not the worker forwards the shell to the
 * renderer at run time: the literal is in the emitted text either way. It cannot distinguish "the
 * shell is passed" from "the shell is mentioned", which is the whole of B-001's second
 * Definition-of-done bullet — *"a regression test executes the generated entry against a real
 * `Request` rather than asserting `toContain` over the template string"*.
 *
 * They are kept rather than replaced (plan ADR-2). The two fail on different defects: an entry that
 * stops emitting the call never parses into a `fetch` to execute, and the string test is what names
 * which half broke.
 *
 * ## The stub echoes what it received, and counts that it ran
 *
 * A stub returning a canned document containing `<head>` would pass on an entry that forwards
 * nothing — the head would come from the stub. So it builds its response from the `htmlHead` and
 * `htmlTail` it was HANDED (plan ADR-1).
 *
 * And the invocation count is asserted BEFORE the body, because a body assertion is vacuous if the
 * streaming branch was never taken. That is not caution: measured in this repository's own M1
 * acceptance attempt on 2026-09-18, three cases scored PASS on a 403 that CSRF produced before the
 * policy under test was ever consulted. A refusal for the wrong reason is not evidence that the
 * right reason works.
 *
 * ## Each load gets its own module URL
 *
 * Node's ESM loader caches by resolved URL (plan ADR-3). Two cases writing to one path would make
 * the second import return the FIRST module, so it would assert against an entry it did not
 * generate — and would keep passing after the streaming entry stopped forwarding the shell.
 */
describe('the served document carries the shell, proved by running the worker', () => {
  const root = mkdtempSync(join(tmpdir(), 'theokit-cf-stream-'))
  let counter = 0

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** What the stub recorded, so a case can assert on what the entry actually forwarded. */
  interface Seen {
    readonly calls: number
    readonly head: string | undefined
  }

  async function loadWorker(
    head: string,
    tail: string,
  ): Promise<{ fetch: (r: Request) => Promise<Response>; seen: () => Seen }> {
    counter += 1
    const dir = join(root, `entry-${String(counter)}`)
    mkdirSync(dir, { recursive: true })

    // Written beside the entry and imported by it. The counter in the filename is what keeps the
    // ESM cache from answering this load with an earlier one.
    const stub = join(dir, 'server.mjs')
    writeFileSync(
      stub,
      `export let calls = 0
export let head
export const matchRoute = () => null
export const compilePattern = () => ({})
export const executeRoute = () => {}
export const createProductionLoader = () => () => ({})
export const createWebShim = () => ({ req: {}, res: { setHeader() {}, statusCode: 200 }, toResponse: () => new Response('route') })
export const buildSecurityHeaders = () => ({})
export const withSecurityHeaders = (r) => r
export const generateNonce = () => 'n'
export const createCloudflareWsBridge = () => ({ handle: () => new Response(null) })
export const extractTraceIdFromRequest = () => 't'
export const TRACE_HEADER = 'x-trace-id'
export const createCorsWebHandler = () => null
export const createPluginRunnerFromConfig = async () => undefined
export const resolveTransformer = (s) => ({ name: s })
export const mountAgent = async () => new Response('agent')
export const resolveProvider = () => ({ apiKey: 'sk-test' })
export const scanAgents = () => []
export const renderStreamingWeb = async (request, options = {}) => {
  calls += 1
  head = options.htmlHead
  return new Response(
    (options.htmlHead ?? '') + '<script id="theokit-data">{}</script>' + (options.htmlTail ?? ''),
    { headers: { 'content-type': 'text/html' } },
  )
}
`,
      'utf8',
    )

    const entry = renderCloudflareWorkerEntry({
      ssrStreaming: true,
      htmlHead: head,
      htmlTail: tail,
    })
    const file = join(dir, 'worker.mjs')
    // Every bare specifier goes to the stub — the same rewrite
    // `cloudflare-serves-the-document.test.ts` uses, and for the same reason: the emitted entry
    // imports from `theokit/...` subpaths that do not resolve from a temp directory. A narrower
    // pattern left them alone and the RED failed with `Cannot find package 'theokit'`, which the
    // plan's TDD step rules out by name — the RED must fail on the assertion, not on the import.
    writeFileSync(
      file,
      entry.replace(
        /^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gmu,
        `$1'${pathToFileURL(stub).href}'`,
      ),
      'utf8',
    )

    const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
      default: { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }
    }
    const probe = (await import(/* @vite-ignore */ pathToFileURL(stub).href)) as {
      calls: number
      head?: string
    }
    return {
      fetch: (r: Request) => mod.default.fetch(r, {}, {}),
      seen: () => ({ calls: probe.calls, head: probe.head }),
    }
  }

  it('test_the_served_document_carries_the_head_and_the_hydration_script', async () => {
    const worker = await loadWorker(HEAD, TAIL)
    const response = await worker.fetch(new Request('https://app.test/'))

    // FIRST, and deliberately. Everything below is vacuous if the branch was never taken.
    expect(
      worker.seen().calls,
      'the streaming renderer was never invoked, so the body proves nothing',
    ).toBe(1)

    const body = await response.text()
    expect(body).toContain('<head>')
    expect(body).toContain('id="theokit-data"')
  })

  it('test_a_shell_carrying_a_closing_script_tag_is_still_forwarded_intact', async () => {
    // The neighbouring `test_the_inlined_template_survives_being_embedded_in_source` establishes
    // that this shape is real here. Containment cannot show it survived; equality can.
    const awkward = `${HEAD}<script>var x = "</script>";</script>`
    const worker = await loadWorker(awkward, TAIL)
    await worker.fetch(new Request('https://app.test/'))

    expect(worker.seen().calls).toBe(1)
    expect(worker.seen().head).toBe(awkward)
  })
})

/** Pull the emitted literal for a named field out of the generated source. */
function extractLiteral(source: string, field: string): string {
  const match = new RegExp(`${field}: ("(?:[^"\\\\]|\\\\.)*")`).exec(source)
  if (match === null) throw new Error(`no literal emitted for ${field}`)
  return match[1]
}
