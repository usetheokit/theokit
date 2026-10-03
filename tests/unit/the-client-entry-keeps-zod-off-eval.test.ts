import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateEntryClient } from '../../packages/theo/src/router/entry.js'

/**
 * #937 — every page load of the default scaffold filed a CSP violation report.
 *
 * zod v4 probes for `eval` support with `new Function("")` the first time it parses an object
 * schema. The default CSP refuses it, zod catches the refusal and falls back to its jitless path, and
 * the browser still POSTs a `script-src` report to `/__theo/csp-report` for every visitor. The zod in
 * the page chunk is `@theokit/presenter`'s wire validation, not the app's.
 *
 * Under that CSP the jitless path is where zod ends up anyway, so the client entry sets it before
 * anything renders. `zod` is a required peer of `theokit`, so the import resolves in every app and
 * reaches the instance the page chunk uses.
 */

const SETUP = `__theoConfigureZod({ jitless: true })`

describe('the client entry configures zod before anything renders', () => {
  it.each([true, false])('test_the_entry_turns_on_jitless_before_rendering (ssr=%s)', (ssr) => {
    const out = generateEntryClient(ssr)

    expect(out).toContain(`import { config as __theoConfigureZod } from 'zod'`)
    expect(out).toContain(SETUP)
    expect(out.indexOf(SETUP)).toBeLessThan(out.indexOf('createBrowserRouter('))
  })
})

describe('with jitless on, zod parses an object without constructing a Function', () => {
  const realFunction = globalThis.Function

  afterEach(() => {
    globalThis.Function = realFunction
  })

  /**
   * A fresh zod per test: it caches the probe's answer in module scope, so a second parse in the
   * same instance would never probe and every assertion below would pass for the wrong reason.
   * The config lives on `globalThis`, so it is restored too.
   */
  async function parseUnderCsp(jitless: boolean): Promise<number> {
    vi.resetModules()
    const zod = await import('zod')
    const before = zod.config().jitless
    // A CSP that forbids eval makes `new Function` throw. Counting the attempts is what the browser
    // reports on: an attempt that throws is still a violation.
    let attempts = 0
    globalThis.Function = new Proxy(realFunction, {
      construct() {
        attempts += 1
        throw new EvalError('refused by the content security policy')
      },
    })
    try {
      zod.config({ jitless })
      const parsed = zod.z.object({ kind: zod.z.string() }).parse({ kind: 'x' })
      expect(parsed).toEqual({ kind: 'x' })
      return attempts
    } finally {
      zod.config({ jitless: before })
    }
  }

  it('test_without_jitless_an_object_parse_tries_the_Function_constructor', async () => {
    // The counter-proof: the spy sees the probe, so a zero below means something.
    expect(await parseUnderCsp(false)).toBeGreaterThan(0)
  })

  it('test_with_jitless_an_object_parse_never_tries_the_Function_constructor', async () => {
    expect(await parseUnderCsp(true)).toBe(0)
  })
})
