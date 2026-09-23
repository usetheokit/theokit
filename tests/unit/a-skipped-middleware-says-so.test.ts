import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  _resetMiddlewareCacheForTests,
  _resetUninvocableWarningsForTests,
  runMiddlewareAndContext,
} from '../../packages/theo/src/server/http/middleware-runner.js'

/**
 * B-266 — a middleware the runner cannot invoke names itself instead of vanishing.
 *
 * `middleware()` is fluent: `middleware('name').handle(fn).build()`. Called as
 * `middleware({ name, handler })` it returns the UN-BUILT builder, an object. The runner reads
 * `typeof mw !== 'function'` and skipped it in total silence — the file found, the module evaluated,
 * the handler never called, nothing said.
 *
 * Found by making the mistake while writing B-003's regression test, WITH the source open, and
 * spending two rounds measuring the runner before doubting the call. A consumer has neither the
 * source nor the suspicion, which is the whole argument for the diagnostic.
 *
 * The fixtures do not import `theokit` at all. A plain object with `handle`/`build` reproduces what
 * the un-built builder IS, and depending on the real builder here would couple this suite to that
 * API's shape — the thing most likely to change once B-266's sibling item revisits it.
 */

const FIXTURE_ROOT = join(process.cwd(), 'tests', '.tmp-skipped-middleware')

let serverDir: string

const loadModule = async (path: string): Promise<Record<string, unknown>> =>
  (await import(/* @vite-ignore */ pathToFileURL(path).href)) as Record<string, unknown>

function writeInDir(name: string, source: string): void {
  mkdirSync(join(serverDir, 'middleware'), { recursive: true })
  writeFileSync(join(serverDir, 'middleware', name), source)
}

function nodePair(): { req: IncomingMessage; res: ServerResponse } {
  const req = {
    method: 'GET',
    url: '/api/thing',
    headers: { host: 'app.test' },
  } as unknown as IncomingMessage
  const res = {
    statusCode: 200,
    writableEnded: false,
    headersSent: false,
    setHeader() {},
    getHeader: () => undefined,
    end() {},
    write() {
      return true
    },
  } as unknown as ServerResponse
  return { req, res }
}

/** What an un-built `middleware()` call returns: an object carrying `handle` and `build`. */
const UNBUILT_BUILDER = `export default { handle() { return this }, build() { return () => {} } }\n`

beforeEach(() => {
  _resetMiddlewareCacheForTests()
  _resetUninvocableWarningsForTests()
  mkdirSync(FIXTURE_ROOT, { recursive: true })
  serverDir = mkdtempSync(join(FIXTURE_ROOT, 'server-'))
})

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
})

describe('a middleware the runner cannot invoke says so (B-266)', () => {
  it('test_an_unbuilt_builder_names_itself_and_the_missing_build', async () => {
    // AC-001. The message has to carry BOTH the path and what to do, because the author's mistake is
    // invisible from the symptom: the request succeeds and the middleware simply did not happen.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeInDir('01-unbuilt.js', UNBUILT_BUILDER)

    const { req, res } = nodePair()
    await runMiddlewareAndContext(req, res, loadModule, serverDir)

    const lines = warn.mock.calls.map((c) => String(c[0]))
    warn.mockRestore()
    expect(
      lines.join('\n'),
      'a middleware was skipped without saying so. The request succeeds and the middleware did not ' +
        'run, which is indistinguishable from a middleware that ran and did nothing.',
    ).toMatch(/01-unbuilt\.js/)
    expect(lines.join('\n'), 'the message does not say what to do about it').toMatch(/\.build\(\)/)
  })

  it('test_aborted_stays_false_so_the_request_is_still_answered', async () => {
    // AC-002. `ab56b3888` removed a refusal deliberately; a diagnostic that also refused would
    // reverse that decision under cover of improving the message.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeInDir('01-unbuilt.js', UNBUILT_BUILDER)

    const { req, res } = nodePair()
    const result = await runMiddlewareAndContext(req, res, loadModule, serverDir)
    warn.mockRestore()

    expect(
      result.aborted,
      'the diagnostic aborted the request. It is a warning, not a refusal — reinstating a refusal is ' +
        'explicitly out of this item’s scope.',
    ).toBe(false)
  })

  it('test_once_per_path_per_process_and_not_once_per_request', async () => {
    // AC-003. The scan is cached (CR-017) but `loadModule` runs per file per request, so an unlatched
    // warning emits one line per request — which is how a diagnostic becomes noise and then becomes
    // filtered. Two runs, one warning.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeInDir('01-unbuilt.js', UNBUILT_BUILDER)

    const first = nodePair()
    await runMiddlewareAndContext(first.req, first.res, loadModule, serverDir)
    const second = nodePair()
    await runMiddlewareAndContext(second.req, second.res, loadModule, serverDir)

    const count = warn.mock.calls.filter((c) => String(c[0]).includes('01-unbuilt.js')).length
    warn.mockRestore()
    expect(
      count,
      'the warning fired more than once for one file. Per-request output turns a diagnostic into ' +
        'noise, and noise gets filtered — at which point the defect is silent again.',
    ).toBe(1)
  })

  it('test_the_single_file_arm_reports_it_too', async () => {
    // AC-004. This file has already watched its two arms drift: `runScannedMiddleware`'s docblock
    // records that the single-file arm kept `refuseIncompatibleShape` "only because someone
    // remembered to add it twice". One report function, asserted from both sides.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(join(serverDir, 'middleware.js'), UNBUILT_BUILDER)

    const { req, res } = nodePair()
    await runMiddlewareAndContext(req, res, loadModule, serverDir)

    const lines = warn.mock.calls.map((c) => String(c[0])).join('\n')
    warn.mockRestore()
    expect(
      lines,
      'the single `server/middleware.js` arm skipped silently while the directory arm reported. ' +
        'Two load sites, one semantics — a divergence here is the drift the dispatcher is single for.',
    ).toMatch(/middleware\.js/)
  })

  it('test_a_correctly_built_middleware_stays_silent', async () => {
    // AC-005. The diagnostic must be about the non-invocable case only. A warning on a working
    // middleware would be worse than the silence it replaced: everyone learns to ignore it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeInDir('01-fine.js', `export default function (req, res, next) { next() }\n`)

    const { req, res } = nodePair()
    await runMiddlewareAndContext(req, res, loadModule, serverDir)

    const noise = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('01-fine.js'))
    warn.mockRestore()
    expect(
      noise,
      'a working middleware was warned about. A diagnostic that fires on correct code is a ' +
        'diagnostic people learn to ignore, and then it protects nobody.',
    ).toHaveLength(0)
  })

  it('test_a_non_object_default_is_described_by_its_type', async () => {
    // Not in the brief's AC list, and added because writing the describe() branch made the gap
    // obvious: `export default 42` and `export default {}` are both non-invocable and a message that
    // said "a builder that was never built" for either would be confidently wrong.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeInDir('01-number.js', `export default 42\n`)

    const { req, res } = nodePair()
    await runMiddlewareAndContext(req, res, loadModule, serverDir)

    const lines = warn.mock.calls.map((c) => String(c[0])).join('\n')
    warn.mockRestore()
    expect(
      lines,
      'a numeric default export was described as something else. The message names what arrived, ' +
        'so it must not guess a builder when there is none.',
    ).toMatch(/type `number`/)
  })
})
