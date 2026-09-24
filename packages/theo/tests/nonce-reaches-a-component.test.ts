/**
 * B-270 — the framework mints a CSP nonce, stamps its own scripts, and gives an application no way
 * to obtain it.
 *
 * The node SSR target mints a per-request nonce and stamps it onto the three scripts IT emits. An
 * application that needs one inline script of its own — a theme-init script, say — has no way to
 * read that value, so its script carries no nonce and the browser refuses it. `useNonce()` is the
 * seam.
 *
 * Eight cases live in this file and no more: the alignment brief's AC-001 pins `^ok ` at exactly 8
 * over this path, and that brief carries two peers' signatures. T1.3's concurrency case and AC-016's
 * streaming case are in their own files for that reason, not because they belong apart.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'

import * as clientBarrel from '../src/client/index.js'
import { withHoistedHead } from '../src/cli/commands/start/request-handler.js'
import { generateEntryServer } from '../src/router/entry-server.js'
import { NonceProvider, useNonce } from '../src/client/nonce.js'

/** Render `useNonce()` under a provider and hand back what the child actually saw. */
function readNonceUnder(nonce: string | undefined): { seen: string | undefined; html: string } {
  let seen: string | undefined
  function Child(): React.ReactNode {
    seen = useNonce()
    return null
  }
  const html = renderToStaticMarkup(
    React.createElement(NonceProvider, { nonce }, React.createElement(Child)),
  )
  return { seen, html }
}

describe('useNonce', () => {
  it('the hook reads the nonce the header carries', () => {
    expect(readNonceUnder('abc').seen).toBe('abc')
  })

  it('the hook returns undefined when no nonce was minted', () => {
    // A build target that mints no nonce is not an error state: the CSP simply carries none, and
    // the consumer's `nonce={useNonce()}` must render the attribute away rather than as "undefined".
    expect(readNonceUnder(undefined).seen).toBeUndefined()
  })

  it('the nonce is absent from the client bundle state', () => {
    // FR-003. The whole security argument is that a nonce readable from the page is a nonce an
    // attacker can copy onto an injected tag, so it must reach the tree WITHOUT reaching the
    // hydration payload. Two halves, because either alone passes vacuously:
    //
    //   1. the value really was in the render  — otherwise "absent from the payload" is trivially
    //      true of a nonce nobody supplied;
    //   2. the payload the framework GENERATES carries no nonce key — this is the half that goes
    //      red the moment someone adds one, because those keys are emitted source text.
    const sentinel = 'nonce-sentinel-do-not-serialise'
    const { seen } = readNonceUnder(sentinel)
    expect(seen).toBe(sentinel)

    const hydrationData = { loaderData: {}, actionData: null, errors: null }
    expect(JSON.stringify(hydrationData)).not.toContain(sentinel)

    // The generated entry's own payload object, read out of the source it emits.
    const src = generateEntryServer({ theoUi: { theme: 'violet-forge' } })
    const open = src.indexOf('const hydrationData = {')
    expect(open).toBeGreaterThan(-1)
    const payloadBlock = src.slice(open, src.indexOf('}', open))
    expect(payloadBlock).not.toContain('nonce')
  })

  it('an unstamped inline script in the body keeps no nonce', () => {
    // FR-004, as a REGRESSION test over today's behaviour rather than a claim about a change. The
    // one-line "fix" for this whole item — extending `applyNonceToInlineScripts` to the SSR body —
    // is a security regression: the regex stamps a script inlined from untrusted content exactly as
    // readily as a framework one. This case goes red the moment anyone stamps the body, wherever
    // they add it, which a path-scoped diff could never do: `applyNonceToInlineScripts` has four
    // call sites and the stamp can also be added in the renderer `entry-server.ts` generates.
    const { head, body } = withHoistedHead(
      '<head><script>theme()</script></head>',
      '<div id="root"><script>untrusted()</script></div>',
      'nonce-from-the-header',
    )

    // The head IS stamped — that is the framework's own template, and asserting it here keeps the
    // case from passing because the nonce never arrived at all.
    expect(head).toContain('nonce-from-the-header')
    expect(body).not.toContain('nonce=')
    expect(body).not.toContain('nonce-from-the-header')
  })

  /**
   * FR-002. Asserted PER BRANCH, on a separate generator call each, because a single count over the
   * generator's source rewards wrapping only one of the two return shapes — and the `theoUi` branch is
   * the one `@theokit/ui` consumers hit, which is to say the ones rendering `ThemeScript`.
   *
   * Three things per branch, because presence alone is too weak: the import has to be emitted (an
   * element referencing an unimported name is a module that throws on evaluation), the provider has to
   * receive `options.nonce` and not some other expression, and it has to sit OUTSIDE
   * `StaticRouterProvider` — a provider nested inside the thing it should wrap supplies nothing.
   */
  function expectWrappedTree(src: string): void {
    expect(src).toContain("import { NonceProvider } from 'theokit/client'")
    expect(
      src.split('React.createElement(NonceProvider, { nonce: options.nonce },').length - 1,
    ).toBe(1)
    expect(src.indexOf('React.createElement(NonceProvider')).toBeLessThan(
      src.indexOf('React.createElement(StaticRouterProvider'),
    )
  }

  it('the provider wraps the tree with theoUi on', () => {
    expectWrappedTree(generateEntryServer({ theoUi: { theme: 'violet-forge' } }))
  })

  it('the provider wraps the tree with theoUi off', () => {
    expectWrappedTree(generateEntryServer({}))
  })

  it('the provider adds exactly one element to the SSR tree', () => {
    // NFR-001's NUMBER. T2.1 proves the provider wraps both branches and AC-011 proves the client
    // entry gains none, which together leave "≤ 1 extra element" unasserted — a tree wrapped five
    // times satisfies both.
    //
    // An ABSOLUTE count, not a delta between two generator calls. `EntryServerOptions` declares only
    // `streaming?` and `theoUi?`: there is no generation-time nonce, so two calls emit byte-identical
    // text and the delta is 0 in every state. Adding such an option to force one would be worse —
    // the sole production caller passes neither, so the shipped entry would carry no provider at all
    // while the criterion went green, rewarding the implementation that breaks FR-002.
    //
    // And `React.createElement(NonceProvider` rather than the bare name, because the import statement
    // contains the name too: the bare count collides, 2 being both "correct single wrap" and "wrapped
    // twice with the import forgotten". The bare count is asserted as a consistency check beside it.
    const count = (src: string, lit: string): number => src.split(lit).length - 1

    const themed = generateEntryServer({ theoUi: { theme: 'violet-forge' } })
    expect(count(themed, 'React.createElement(')).toBe(4)
    expect(count(themed, 'React.createElement(NonceProvider')).toBe(1)
    expect(count(themed, 'NonceProvider')).toBe(2)

    const plain = generateEntryServer({})
    expect(count(plain, 'React.createElement(')).toBe(3)
    expect(count(plain, 'React.createElement(NonceProvider')).toBe(1)
    expect(count(plain, 'NonceProvider')).toBe(2)
  })

  it('useNonce is exported from theokit slash client', () => {
    // FR-001's other half: the value is reachable through the PUBLISHED subpath, not merely from the
    // module that defines it. A deep import into `src/client/nonce.js` is not a surface a consumer has.
    expect(clientBarrel.useNonce).toBe(useNonce)
    expect(clientBarrel.NonceProvider).toBe(NonceProvider)
  })
})
