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

  it('useNonce is exported from theokit slash client', () => {
    // FR-001's other half: the value is reachable through the PUBLISHED subpath, not merely from the
    // module that defines it. A deep import into `src/client/nonce.js` is not a surface a consumer has.
    expect(clientBarrel.useNonce).toBe(useNonce)
    expect(clientBarrel.NonceProvider).toBe(NonceProvider)
  })
})
