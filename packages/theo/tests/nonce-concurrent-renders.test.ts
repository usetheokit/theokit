/**
 * ADR-1's rejection of a module-level variable, MEASURED rather than argued.
 *
 * The entry renders through `renderToPipeableStream`, which is concurrent by construction. A
 * module-level variable holding the nonce would be shared across every request in one process, so
 * request A's nonce would reach request B's markup. The plan rejected that design on exactly this
 * reasoning and, for three drafts, asserted it nowhere: T2.1 said the property "is ADR-1 and is
 * asserted by T1.1", and T1.1 declared `(none — single-threaded)`.
 *
 * Its own file, not this plan's preference: the alignment brief's signed AC-001 pins `^ok ` at
 * exactly 8 over `nonce-reaches-a-component.test.ts`, and a ninth case there fails a signed criterion.
 */
import { Writable } from 'node:stream'

import React, { Suspense, use } from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { describe, it, expect } from 'vitest'

import { NonceProvider, useNonce } from '../src/client/nonce.js'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Suspends until its own gate resolves, then renders whatever nonce its provider carries. */
function GatedNonce({ gate }: Readonly<{ gate: Promise<void> }>): React.JSX.Element {
  use(gate)
  return React.createElement('div', null, `nonce=${String(useNonce())}`)
}

function renderGated(nonce: string, gate: Promise<void>): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let html = ''
    const sink = new Writable({
      write(chunk, _enc, cb) {
        html += String(chunk)
        cb()
      },
    })
    sink.on('finish', () => resolve(html))
    const tree = React.createElement(NonceProvider, {
      nonce,
      children: React.createElement(
        Suspense,
        { fallback: null },
        React.createElement(GatedNonce, { gate }),
      ),
    })
    const { pipe } = renderToPipeableStream(tree, {
      onAllReady() {
        pipe(sink)
      },
      onError: reject,
    })
  })
}

describe('concurrent SSR renders', () => {
  it('two concurrent renders keep their own nonce', async () => {
    const gateA = deferred()
    const gateB = deferred()

    // A starts and suspends; B starts BEFORE A resolves. The interleaving is forced, not hoped for:
    // a design that shared the value would have B's provider overwrite A's while A is still pending.
    const renderA = renderGated('nonce-A', gateA.promise)
    const renderB = renderGated('nonce-B', gateB.promise)

    gateA.resolve()
    gateB.resolve()

    const [htmlA, htmlB] = await Promise.all([renderA, renderB])

    expect(htmlA).toContain('nonce=nonce-A')
    expect(htmlA).not.toContain('nonce-B')
    expect(htmlB).toContain('nonce=nonce-B')
    expect(htmlB).not.toContain('nonce-A')
  })
})
